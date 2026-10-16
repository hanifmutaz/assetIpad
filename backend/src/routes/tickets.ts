import express from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, bad, conflict, forbidden, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { getRules, getMaster } from '../services/rules.js';
import { audit, history } from '../services/audit.js';
import { assertDeviceVisible, canHandleTicket, deviceScope } from '../services/access.js';
import { saveImage, upload } from '../services/files.js';
import { can, TRANS, needApproval, needReason, IN_USE, TICKET_ST, type Status } from '../services/policy.js';

export const router = express.Router();
const STATE = `CASE WHEN t.status='Closed' THEN 'Closed' WHEN t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $1) THEN 'Eskalasi' ELSE t.status END`;
const BASE = `SELECT t.id, 'TK-'||lpad(t.id::text,4,'0') code, t.device_id, t.type, t.descr, t.priority, t.status, ${STATE} AS state,
  t.reporter_name, t.created_at, t.closed_at, t.photo_id, COALESCE(d.name,d.serial) device_name, d.serial, d.status device_status, d.department_id,
  s.name section, l.name lokasi, dp.name department
  FROM ticket t JOIN device d ON d.id=t.device_id JOIN section s ON s.id=d.section_id JOIN lokasi l ON l.id=s.lokasi_id JOIN department dp ON dp.id=d.department_id`;

router.get('/', ah(async (req, res) => {
  const f = z.enum(['aktif', 'eskalasi', 'selesai', 'semua']).default('aktif').parse(req.query.f || undefined);
  const R = await getRules();
  const cond = { aktif: `(${STATE}) <> 'Closed'`, eskalasi: `(${STATE}) = 'Eskalasi'`, selesai: "t.status='Closed'", semua: 'true' }[f];
  const sc = deviceScope(req.user!, 'd', 2);
  const r = await q(`${BASE} WHERE ${cond} AND ${sc.sql} ORDER BY t.created_at DESC LIMIT 500`, [R.escalateDays, ...sc.params]);
  res.json(r.rows.map((t) => ({ ...t, can_handle: canHandleTicket(req.user!, t.department_id) && t.state !== 'Closed' })));
}));

router.get('/:id', ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const R = await getRules();
  const t = (await q(`${BASE} WHERE t.id=$2`, [R.escalateDays, id])).rows[0];
  if (!t) throw notFound('Tiket tidak ditemukan');
  await assertDeviceVisible(req.user!, t.device_id);
  const log = (await q('SELECT at, by_name, text FROM ticket_log WHERE ticket_id=$1 ORDER BY at', [id])).rows;
  const ch = canHandleTicket(req.user!, t.department_id) && t.state !== 'Closed';
  res.json({ ...t, log, can_handle: ch,
    device_transitions: ch && can(req.user, 'device.status') ? TRANS[t.device_status as Status].filter((x) => !needApproval(t.device_status, x)) : [] });
}));

router.post('/', requirePerm('ticket.create'), upload.single('photo'), ah(async (req, res) => {
  const b = z.object({ deviceId: z.string().uuid(), type: z.string().min(1).max(60), priority: z.enum(['Normal', 'Tinggi']),
    descr: z.string().trim().min(3).max(2000), force: z.enum(['0', '1']).optional() }).parse(req.body);
  if (!(await getMaster('problem')).includes(b.type)) throw bad('Jenis masalah tidak valid');
  await assertDeviceVisible(req.user!, b.deviceId);
  const out = await tx(async (c) => {
    const d = (await c.query('SELECT status FROM device WHERE id=$1', [b.deviceId])).rows[0];
    if (![...IN_USE, 'Setup'].includes(d.status)) throw bad(`iPad berstatus ${d.status} tidak bisa dilaporkan`);
    if (b.force !== '1' && (await c.query("SELECT 1 FROM ticket WHERE device_id=$1 AND status<>'Closed'", [b.deviceId])).rowCount) throw conflict('iPad ini masih punya tiket aktif', 'ACTIVE_TICKET');
    const photo = await saveImage(c, req.file, req.user!.id);
    const r = (await c.query(`INSERT INTO ticket(device_id,type,descr,priority,reporter_id,reporter_name,photo_id) VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, 'TK-'||lpad(id::text,4,'0') code`, [b.deviceId, b.type, b.descr, b.priority, req.user!.id, req.user!.name, photo])).rows[0];
    await history(c, b.deviceId, req.user, `Lapor masalah ${r.code}: ${b.type}`);
    return r;
  });
  res.status(201).json(out);
}));

router.post('/:id/update', ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = z.object({ status: z.enum(TICKET_ST), deviceStatus: z.string().optional().or(z.literal('')), note: z.string().trim().max(1000).optional() }).parse(req.body);
  const R = await getRules();
  await tx(async (c) => {
    await c.query('SELECT 1 FROM ticket WHERE id=$1 FOR UPDATE', [id]);
    const t = (await c.query(`${BASE} WHERE t.id=$2`, [R.escalateDays, id])).rows[0];
    if (!t) throw notFound();
    if (!canHandleTicket(req.user!, t.department_id) || t.status === 'Closed') throw forbidden('Anda tidak berhak menangani tiket ini');
    const parts: string[] = [];
    if (b.deviceStatus) {
      if (!can(req.user, 'device.status')) throw forbidden('Ubah status iPad hanya untuk Admin iPad / Super Admin');
      const from = t.device_status as Status;
      const ds = b.deviceStatus as Status;
      if (!TRANS[from]?.includes(ds) || needApproval(from, ds)) throw bad('Perubahan status iPad ini tidak bisa dari tiket (butuh persetujuan)');
      if (needReason(from, ds) && !b.note) throw bad('Isi catatan sebagai alasan perubahan status iPad');
      await c.query('UPDATE device SET status=$2, last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [t.device_id, ds]);
      await history(c, t.device_id, req.user, `Status ${from} → ${ds} – ${b.note ?? 'via tiket'} (${t.code})`, ds);
      parts.push(`Status iPad ${from} → ${ds}`);
    }
    if (b.status !== t.status) parts.push(`Status tiket → ${b.status}`);
    if (b.note) parts.push(b.note);
    if (!parts.length) return;
    await c.query("UPDATE ticket SET status=$2, closed_at = CASE WHEN $2='Closed' THEN now() ELSE NULL END WHERE id=$1", [id, b.status]);
    if (b.status === 'Closed') await c.query('UPDATE device SET last_check=current_date WHERE id=$1', [t.device_id]);
    await c.query('INSERT INTO ticket_log(ticket_id,by_user,by_name,text) VALUES($1,$2,$3,$4)', [id, req.user!.id, req.user!.name, parts.join('. ')]);
  });
  await audit(req, { action: 'Update tiket', target: `TK-${String(id).padStart(4, '0')}` });
  res.json({ ok: true });
}));
