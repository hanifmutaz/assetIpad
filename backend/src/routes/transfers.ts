// Mutasi / pindah tempat: diajukan Admin iPad, disetujui Super Admin. Bila perlu reset → iPad kembali ke Setup (skenario "reset").
import express from 'express';
import { z } from 'zod';
import { q, tx, type Db } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit, history } from '../services/audit.js';
import { getMaster } from '../services/rules.js';
import { can, IN_USE } from '../services/policy.js';
import type { AuthUser } from '../types.js';

export const router = express.Router();

router.get('/', requirePerm('transfer.request', 'approval.decide'), ah(async (_req, res) => {
  const r = await q(`SELECT t.id, 'MT-'||lpad(t.id::text,4,'0') code, t.device_id, COALESCE(d.name,d.serial) device_name, d.serial, t.reason, t.move_date, t.status, t.reset_required,
      fl.name from_lokasi, fs.name from_section, fd.name from_department, t.from_user_name, t.from_purpose,
      tl.name to_lokasi, ts.name to_section, td.name to_department, t.to_user_name, t.to_purpose,
      t.requested_by, t.requested_by_name, t.decided_by_name, t.decision_note, t.created_at
    FROM transfer t JOIN device d ON d.id=t.device_id
    JOIN section fs ON fs.id=t.from_section_id JOIN lokasi fl ON fl.id=fs.lokasi_id JOIN department fd ON fd.id=t.from_department_id
    JOIN section ts ON ts.id=t.to_section_id JOIN lokasi tl ON tl.id=ts.lokasi_id JOIN department td ON td.id=t.to_department_id
    ORDER BY (t.status='Pending') DESC, t.created_at DESC LIMIT 300`);
  res.json(r.rows);
}));

async function applyTransfer(c: Db, t: Record<string, any>, u: AuthUser): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const code = `MT-${String(t.id).padStart(4, '0')}`;
  const from = (await c.query('SELECT s.lokasi_id FROM section s WHERE s.id=$1', [t.from_section_id])).rows[0];
  await c.query('UPDATE device SET section_id=$2, department_id=$3, user_name=$4, purpose=$5, updated_at=now(), version=version+1 WHERE id=$1',
    [t.device_id, t.to_section_id, t.to_department_id, t.to_user_name, t.to_purpose]);
  if (t.reset_required) {
    await c.query("UPDATE config_run SET finished_at=now() WHERE device_id=$1 AND finished_at IS NULL", [t.device_id]);
    await c.query("INSERT INTO config_run(device_id,scenario,from_lokasi_id,from_purpose,started_by,transfer_id) VALUES($1,'reset',$2,$3,$4,$5)",
      [t.device_id, from?.lokasi_id ?? null, t.from_purpose, u.id, t.id]);
    // Reset iPad memakai passcode default 123456 → wajib diganti di langkah terakhir
    await c.query("UPDATE device SET status='Setup', passcode_default=true WHERE id=$1", [t.device_id]);
    await history(c, t.device_id, u, `Mutasi ${code} disetujui – iPad direset & masuk konfigurasi ulang`, 'Setup');
  } else {
    await history(c, t.device_id, u, `Mutasi ${code} disetujui (tanpa reset)`);
  }
}

router.post('/', requirePerm('transfer.request'), ah(async (req, res) => {
  const b = z.object({
    deviceId: z.string().uuid(), sectionId: z.number().int(), departmentId: z.number().int(), purpose: z.string().min(1).max(60),
    userName: z.string().trim().min(1).max(120), moveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(500),
    resetRequired: z.boolean(),
  }).parse(req.body);
  if (!(await getMaster('purpose')).includes(b.purpose)) throw bad('Peruntukan tidak valid');
  const u = req.user!;
  const r = await tx(async (c) => {
    const d = (await c.query('SELECT id, section_id, department_id, user_name, purpose, status FROM device WHERE id=$1 FOR UPDATE', [b.deviceId])).rows[0];
    if (!d) throw notFound('iPad tidak ditemukan');
    if (!IN_USE.includes(d.status)) throw bad(`iPad berstatus ${d.status} tidak bisa dimutasi`);
    if (d.section_id === b.sectionId && d.department_id === b.departmentId && d.user_name === b.userName && d.purpose === b.purpose) throw bad('Tujuan sama dengan posisi sekarang');
    if ((await c.query("SELECT 1 FROM transfer WHERE device_id=$1 AND status='Pending'", [b.deviceId])).rowCount) throw conflict('iPad ini masih punya pengajuan mutasi yang belum diproses');
    const direct = can(u, 'approval.decide'); // Super Admin: langsung berlaku
    const ins = (await c.query(`INSERT INTO transfer(device_id,from_section_id,from_department_id,from_user_name,from_purpose,to_section_id,to_department_id,to_user_name,to_purpose,
        reason,move_date,reset_required,status,requested_by,requested_by_name,decided_by,decided_by_name,decided_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [b.deviceId, d.section_id, d.department_id, d.user_name, d.purpose, b.sectionId, b.departmentId, b.userName, b.purpose, b.reason, b.moveDate, b.resetRequired,
      direct ? 'Approved' : 'Pending', u.id, u.name, direct ? u.id : null, direct ? u.name : null, direct ? new Date() : null])).rows[0];
    if (direct) await applyTransfer(c, ins, u);
    else await history(c, b.deviceId, u, `Pengajuan mutasi MT-${String(ins.id).padStart(4, '0')} ke Super Admin`);
    return { id: ins.id, direct };
  });
  await audit(req, { action: r.direct ? 'Mutasi (langsung, Super Admin)' : 'Ajukan mutasi', deviceId: b.deviceId, target: `MT-${r.id}` });
  res.status(201).json(r);
}));

router.post('/:id/decide', requirePerm('approval.decide'), ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(req.body);
  await tx(async (c) => {
    const t = (await c.query("SELECT * FROM transfer WHERE id=$1 AND status='Pending' FOR UPDATE", [id])).rows[0];
    if (!t) throw notFound('Pengajuan tidak ditemukan / sudah diproses');
    if (!b.approve && !b.note) throw bad('Isi alasan penolakan');
    const d = (await c.query('SELECT status FROM device WHERE id=$1 FOR UPDATE', [t.device_id])).rows[0];
    if (b.approve && !IN_USE.includes(d.status)) throw conflict(`Status iPad sekarang ${d.status}, mutasi tidak bisa diproses`);
    await c.query('UPDATE transfer SET status=$2, decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5 WHERE id=$1',
      [id, b.approve ? 'Approved' : 'Rejected', req.user!.id, req.user!.name, b.note ?? null]);
    if (b.approve) await applyTransfer(c, t, req.user!);
    else await history(c, t.device_id, req.user, `Mutasi MT-${String(id).padStart(4, '0')} ditolak: ${b.note}`);
  });
  await audit(req, { action: b.approve ? 'Setujui mutasi' : 'Tolak mutasi', target: `MT-${id}` });
  res.json({ ok: true });
}));
