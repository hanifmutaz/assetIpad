import express from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { audit, history } from '../services/audit.js';
import { IN_USE } from '../services/policy.js';

export const router = express.Router();

router.get('/', ah(async (req, res) => {
  const r = await q(`SELECT t.id, 'MT-'||lpad(t.id::text,4,'0') code, t.device_id, d.name device_name, d.serial, t.reason, t.move_date, t.status,
      fl.name from_lokasi, fs.name from_section, t.from_user_name, tl.name to_lokasi, ts.name to_section, t.to_user_name,
      t.requested_by_name, t.decided_by_name, t.decision_note, t.created_at
    FROM transfer t JOIN device d ON d.id=t.device_id
    JOIN section fs ON fs.id=t.from_section_id JOIN lokasi fl ON fl.id=fs.lokasi_id
    JOIN section ts ON ts.id=t.to_section_id JOIN lokasi tl ON tl.id=ts.lokasi_id
    ORDER BY (t.status='Pending') DESC, t.created_at DESC LIMIT 300`);
  res.json(r.rows);
}));

router.post('/', requireRole('admin', 'pic', 'user'), ah(async (req, res) => {
  const b = z.object({
    deviceId: z.string().uuid(), sectionId: z.number().int(), userName: z.string().trim().min(1).max(120),
    moveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(500),
  }).parse(req.body);
  const r = await tx(async (c) => {
    const d = (await c.query('SELECT id, section_id, user_name, status FROM device WHERE id=$1', [b.deviceId])).rows[0];
    if (!d) throw notFound('iPad tidak ditemukan');
    if (!IN_USE.includes(d.status)) throw bad(`iPad berstatus ${d.status} tidak bisa dimutasi`);
    if (d.section_id === b.sectionId && d.user_name === b.userName) throw bad('Tujuan sama dengan posisi sekarang');
    const p = await c.query("SELECT 1 FROM transfer WHERE device_id=$1 AND status='Pending'", [b.deviceId]);
    if (p.rowCount) throw conflict('iPad ini masih punya pengajuan mutasi yang belum diproses');
    const ins = await c.query(`INSERT INTO transfer(device_id,from_section_id,from_user_name,to_section_id,to_user_name,reason,move_date,requested_by,requested_by_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, 'MT-'||lpad(id::text,4,'0') code`,
    [b.deviceId, d.section_id, d.user_name, b.sectionId, b.userName, b.reason, b.moveDate, req.user.id, req.user.name]);
    await history(c, b.deviceId, req.user, `Pengajuan mutasi ${ins.rows[0].code}`);
    return ins.rows[0];
  });
  res.status(201).json(r);
}));

router.post('/:id/decide', requireRole('admin'), ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(req.body);
  const out = await tx(async (c) => {
    const t = (await c.query(`SELECT t.*, fs.lokasi_id from_lok, ts.lokasi_id to_lok, ts.name to_section FROM transfer t
      JOIN section fs ON fs.id=t.from_section_id JOIN section ts ON ts.id=t.to_section_id WHERE t.id=$1 AND t.status='Pending' FOR UPDATE OF t`, [id])).rows[0];
    if (!t) throw notFound('Pengajuan tidak ditemukan / sudah diproses');
    if (!b.approve && !b.note) throw bad('Isi alasan penolakan');
    const code = `MT-${String(id).padStart(4, '0')}`;
    await c.query('UPDATE transfer SET status=$2, decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5 WHERE id=$1',
      [id, b.approve ? 'Approved' : 'Rejected', req.user.id, req.user.name, b.note || null]);
    if (!b.approve) {
      await history(c, t.device_id, req.user, `Mutasi ${code} ditolak: ${b.note}`);
      return { crossLokasi: false };
    }
    await c.query('UPDATE device SET section_id=$2, user_name=$3, updated_at=now(), version=version+1 WHERE id=$1', [t.device_id, t.to_section_id, t.to_user_name]);
    await history(c, t.device_id, req.user, `Mutasi ${code} disetujui → ${t.to_section} (pengguna ${t.to_user_name})`);
    return { crossLokasi: t.from_lok !== t.to_lok };
  });
  await audit(req, { action: b.approve ? 'Setujui mutasi' : 'Tolak mutasi', target: `MT-${id}` });
  res.json(out);
}));
