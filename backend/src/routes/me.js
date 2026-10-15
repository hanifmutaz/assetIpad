import express from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, bad, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { getRules, getMaster } from '../services/rules.js';
import { resolveStored } from '../services/files.js';
import { randomToken } from '../crypto.js';
import { audit } from '../services/audit.js';
import { cfg } from '../config.js';

export const router = express.Router();

router.get('/me', ah(async (req, res) => {
  if (!req.session.csrf) req.session.csrf = randomToken();
  const u = req.user;
  const scopes = u.role === 'pic' ? (await q(`SELECT l.name||' · '||s.name AS label FROM pic_scope ps JOIN section s ON s.id=ps.section_id JOIN lokasi l ON l.id=s.lokasi_id
     WHERE ps.user_id=$1 AND ps.start_date<=current_date AND (ps.end_date IS NULL OR ps.end_date>=current_date) ORDER BY 1`, [u.id])).rows.map((r) => r.label) : [];
  res.json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone, dept: u.dept, notif: u.notif, scopes },
    csrf: req.session.csrf,
    stepUpUntil: req.session.stepUpUntil || 0,
    devStepUp: cfg.devLogin && !cfg.isProd,
  });
}));

router.put('/me', ah(async (req, res) => {
  const b = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    dept: z.string().trim().max(80).optional(),
    notif: z.object({ email: z.record(z.boolean()), teams: z.record(z.boolean()) }).optional(),
  }).parse(req.body);
  await q('UPDATE app_user SET name=COALESCE($2,name), phone=COALESCE($3,phone), dept=COALESCE($4,dept), notif=COALESCE($5,notif) WHERE id=$1',
    [req.user.id, b.name, b.phone, b.dept, b.notif ? JSON.stringify(b.notif) : null]);
  res.json({ ok: true });
}));

// data referensi untuk form & filter
router.get('/meta', ah(async (req, res) => {
  const R = await getRules();
  const [lok, sec, master, approvers, pics] = await Promise.all([
    q('SELECT id, name FROM lokasi ORDER BY sort, name'),
    q('SELECT id, lokasi_id, name FROM section ORDER BY name'),
    q('SELECT kind, value FROM master_item ORDER BY sort, value'),
    q("SELECT id, name FROM app_user WHERE active AND role IN ('admin','manager') ORDER BY name"),
    req.user.role === 'admin' ? q("SELECT id, name FROM app_user WHERE active AND role='pic' ORDER BY name") : { rows: [] },
  ]);
  const m = {};
  for (const r of master.rows) (m[r.kind] ||= []).push(r.value);
  res.json({
    lokasi: lok.rows.map((l) => ({ ...l, sections: sec.rows.filter((s) => s.lokasi_id === l.id) })),
    master: m,
    rules: { escalateDays: R.escalateDays, staleDays: R.staleDays, maxAgeYears: R.maxAgeYears, targetIOS: R.targetIOS, lockMin: R.lockMin, prefix: R.prefix },
    approvers: approvers.rows,
    pics: pics.rows,
    oldModels: m.old_model || (await getMaster('old_model')),
  });
}));

// ---- view tersimpan (per user)
router.get('/views', ah(async (req, res) => res.json((await q('SELECT id, name, filters FROM saved_view WHERE user_id=$1 ORDER BY name', [req.user.id])).rows)));
router.post('/views', ah(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60), filters: z.record(z.any()) }).parse(req.body);
  if (JSON.stringify(b.filters).length > 2000) throw bad('Filter terlalu besar');
  await q('INSERT INTO saved_view(user_id,name,filters) VALUES($1,$2,$3) ON CONFLICT (user_id,name) DO UPDATE SET filters=$3', [req.user.id, b.name, JSON.stringify(b.filters)]);
  res.json({ ok: true });
}));
router.delete('/views/:id', ah(async (req, res) => {
  await q('DELETE FROM saved_view WHERE id=$1 AND user_id=$2', [z.coerce.number().int().parse(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

// ---- file (foto tiket / nota) – hanya untuk user login, tidak bisa diakses publik
router.get('/files/:id', ah(async (req, res) => {
  const f = await one('SELECT stored_name, mime FROM file_blob WHERE id=$1', [z.string().uuid().parse(req.params.id)]);
  if (!f) throw notFound('File tidak ditemukan');
  const abs = resolveStored(f.stored_name);
  if (!fs.existsSync(abs)) throw notFound('File tidak ditemukan');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  fs.createReadStream(abs).pipe(res);
}));

// ---- audit & alert (admin)
router.get('/audit', requireRole('admin'), ah(async (req, res) => {
  const b = z.object({ userId: z.string().uuid().optional().or(z.literal('')), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
  const r = await q(`SELECT a.at, a.user_name, a.role, a.action, a.target, a.reason, a.ip, COALESCE(d.name, d.serial) device
    FROM audit_log a LEFT JOIN device d ON d.id=a.device_id ${b.userId ? 'WHERE a.user_id=$2' : ''} ORDER BY a.at DESC LIMIT $1`, b.userId ? [b.limit, b.userId] : [b.limit]);
  const users = await q('SELECT DISTINCT user_id, user_name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name');
  res.json({ rows: r.rows, users: users.rows });
}));
router.get('/alerts', requireRole('admin'), ah(async (req, res) => {
  res.json((await q('SELECT a.*, u.name ack_name FROM access_alert a LEFT JOIN app_user u ON u.id=a.ack_by ORDER BY a.at DESC LIMIT 100')).rows);
}));
router.post('/alerts/:id/ack', requireRole('admin'), ah(async (req, res) => {
  await q('UPDATE access_alert SET ack_by=$2, ack_at=now() WHERE id=$1 AND ack_at IS NULL', [z.coerce.number().int().parse(req.params.id), req.user.id]);
  await audit(req, { action: 'Tinjau alert akses', target: req.params.id });
  res.json({ ok: true });
}));

// ---- notifikasi lonceng
router.get('/notifications', ah(async (req, res) => {
  const R = await getRules();
  const u = req.user;
  const items = [];
  const esk = await one(`SELECT count(*)::int n FROM ticket t LEFT JOIN v_device_pic vp ON vp.device_id=t.device_id
    WHERE t.status<>'Closed' AND (t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $1))
    AND ($2 = 'admin' OR ($2='pic' AND $3::uuid = ANY(COALESCE(vp.pic_ids,'{}'))))`, [R.escalateDays, u.role, u.id]);
  if (esk.n) items.push({ text: `${esk.n} tiket eskalasi`, to: '/lapor?f=eskalasi' });
  if (u.role === 'admin') {
    const p = await one(`SELECT (SELECT count(*)::int FROM transfer WHERE status='Pending') mt, (SELECT count(*)::int FROM access_alert WHERE ack_at IS NULL) al`);
    if (p.mt) items.push({ text: `${p.mt} mutasi menunggu approval`, to: '/registrasi?tab=status' });
    if (p.al) items.push({ text: `${p.al} alert akses credential`, to: '/pengaturan/audit' });
    const cfgs = await q(`SELECT d.id, COALESCE(d.name,'(belum dinamai)') name, d.status, vc.done, vc.total FROM device d JOIN v_device_cfg vc ON vc.device_id=d.id WHERE d.status IN ('Pending','Setup') ORDER BY d.created_at LIMIT 10`);
    for (const d of cfgs.rows) items.push({ text: `${d.status === 'Pending' ? 'Belum dikonfigurasi' : 'Konfigurasi berjalan'}: ${d.name} (${d.done}/${d.total})`, to: `/registrasi/konfigurasi/${d.id}` });
  }
  if (['admin', 'manager'].includes(u.role)) {
    const sr = await one("SELECT count(*)::int n FROM status_request WHERE status='Pending' AND requested_by<>$1", [u.id]);
    if (sr.n) items.push({ text: `${sr.n} perubahan status menunggu persetujuan Anda`, to: '/registrasi?tab=status' });
  }
  res.json(items);
}));
