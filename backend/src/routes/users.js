// User, role & scope PIC – khusus IT Admin.
import express from 'express';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { ROLES } from '../services/policy.js';
import { cfg } from '../config.js';

export const router = express.Router();
router.use(requireRole('admin'));
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function assertAdminRemains(c, exceptId) {
  const r = await c.query("SELECT count(*)::int n FROM app_user WHERE role='admin' AND active AND id<>$1", [exceptId]);
  if (r.rows[0].n < 1) throw conflict('Minimal harus ada 1 IT Admin aktif');
}

router.get('/', ah(async (req, res) => {
  const [u, s, d] = await Promise.all([
    q('SELECT id, email::text email, name, role, active, dept, phone, deactivated_at, deactivated_reason, last_login_at, entra_oid IS NOT NULL AS linked FROM app_user ORDER BY active DESC, name'),
    q(`SELECT ps.id, ps.user_id, ps.section_id, s.name section, l.name lokasi, ps.start_date, ps.end_date,
        (ps.start_date<=current_date AND (ps.end_date IS NULL OR ps.end_date>=current_date)) AS active
       FROM pic_scope ps JOIN section s ON s.id=ps.section_id JOIN lokasi l ON l.id=s.lokasi_id ORDER BY l.name, s.name`),
    q('SELECT pd.user_id, pd.device_id, d.name, d.serial FROM pic_device pd JOIN device d ON d.id=pd.device_id'),
  ]);
  const orphans = await q(`SELECT l.name lokasi, s.name section, count(*)::int n FROM device d JOIN section s ON s.id=d.section_id JOIN lokasi l ON l.id=s.lokasi_id
    LEFT JOIN v_device_pic vp ON vp.device_id=d.id WHERE d.status IN ('Pending','Setup','Available','Repair') AND vp.device_id IS NULL GROUP BY 1,2 ORDER BY 1,2`);
  res.json({
    users: u.rows.map((x) => ({ ...x, scopes: s.rows.filter((y) => y.user_id === x.id), devices: d.rows.filter((y) => y.user_id === x.id) })),
    orphans: orphans.rows,
  });
}));

router.post('/', ah(async (req, res) => {
  const b = z.object({ email: z.string().email().max(160).transform((s) => s.toLowerCase()), name: z.string().trim().min(1).max(120), role: z.enum(ROLES) }).parse(req.body);
  if (cfg.domains.length && !cfg.domains.includes(b.email.split('@')[1])) throw bad(`Email harus domain ${cfg.domains.join(', ')}`);
  const r = await q('INSERT INTO app_user(email,name,role) VALUES($1,$2,$3) RETURNING id', [b.email, b.name, b.role]);
  await audit(req, { action: 'Tambah user', target: `${b.email} (${b.role})` });
  res.status(201).json(r.rows[0]);
}));

router.patch('/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ role: z.enum(ROLES).optional(), name: z.string().trim().min(1).max(120).optional() }).parse(req.body);
  await tx(async (c) => {
    const u = (await c.query('SELECT role FROM app_user WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!u) throw notFound();
    if (b.role && b.role !== 'admin' && u.role === 'admin') {
      if (id === req.user.id) throw bad('Tidak bisa menurunkan role akun sendiri');
      await assertAdminRemains(c, id);
    }
    await c.query('UPDATE app_user SET role=COALESCE($2,role), name=COALESCE($3,name) WHERE id=$1', [id, b.role, b.name]);
  });
  await audit(req, { action: 'Ubah user', target: `${id} ${b.role ? `role=${b.role}` : ''}` });
  res.json({ ok: true });
}));

router.post('/:id/deactivate', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ date, reason: z.string().trim().min(1).max(120) }).parse(req.body);
  if (id === req.user.id) throw bad('Tidak bisa menonaktifkan akun sendiri');
  await tx(async (c) => {
    await assertAdminRemains(c, id);
    const r = await c.query('UPDATE app_user SET active=false, deactivated_at=$2, deactivated_reason=$3 WHERE id=$1', [id, b.date, b.reason]);
    if (!r.rowCount) throw notFound();
    await c.query('UPDATE pic_scope SET end_date=GREATEST(start_date,$2::date) WHERE user_id=$1 AND end_date IS NULL', [id, b.date]);
    await c.query('DELETE FROM pic_device WHERE user_id=$1', [id]);
    // putus semua sesi aktif user ini
    await c.query("DELETE FROM session WHERE (sess->>'userId') = $1", [id]);
  });
  await audit(req, { action: 'Nonaktifkan user', target: id, reason: b.reason });
  res.json({ ok: true });
}));

router.post('/:id/activate', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await q('UPDATE app_user SET active=true, deactivated_at=NULL, deactivated_reason=NULL WHERE id=$1', [id]);
  await audit(req, { action: 'Aktifkan user', target: id });
  res.json({ ok: true });
}));

router.post('/:id/scopes', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ sectionId: z.number().int(), start: date }).parse(req.body);
  const u = (await q('SELECT role, active FROM app_user WHERE id=$1', [id])).rows[0];
  if (!u || u.role !== 'pic' || !u.active) throw bad('Scope hanya untuk user PIC aktif');
  const dup = await q('SELECT 1 FROM pic_scope WHERE user_id=$1 AND section_id=$2 AND end_date IS NULL', [id, b.sectionId]);
  if (dup.rowCount) throw conflict('Section sudah ada di scope');
  await q('INSERT INTO pic_scope(user_id,section_id,start_date) VALUES($1,$2,$3)', [id, b.sectionId, b.start]);
  await audit(req, { action: 'Tambah scope PIC', target: `${id} section ${b.sectionId}` });
  res.status(201).json({ ok: true });
}));

router.post('/scopes/:sid/end', ah(async (req, res) => {
  const sid = z.coerce.number().int().parse(req.params.sid);
  const b = z.object({ date }).parse(req.body);
  const r = await q('SELECT start_date FROM pic_scope WHERE id=$1', [sid]);
  if (!r.rowCount) throw notFound();
  if (b.date < r.rows[0].start_date) await q('DELETE FROM pic_scope WHERE id=$1', [sid]);
  else await q('UPDATE pic_scope SET end_date=$2 WHERE id=$1', [sid, b.date]);
  await audit(req, { action: 'Akhiri scope PIC', target: String(sid) });
  res.json({ ok: true });
}));

router.delete('/:id/devices/:deviceId', ah(async (req, res) => {
  await q('DELETE FROM pic_device WHERE user_id=$1 AND device_id=$2', [uuid.parse(req.params.id), uuid.parse(req.params.deviceId)]);
  res.json({ ok: true });
}));

router.get('/export-access.csv', ah(async (req, res) => {
  const r = await q(`SELECT u.name, u.email::text email, u.role, CASE WHEN u.active THEN 'Aktif' ELSE 'Nonaktif' END status, u.deactivated_at,
      l.name||' · '||s.name scope, ps.start_date, ps.end_date
    FROM app_user u JOIN pic_scope ps ON ps.user_id=u.id JOIN section s ON s.id=ps.section_id JOIN lokasi l ON l.id=s.lokasi_id
    UNION ALL
    SELECT u.name, u.email::text, u.role, CASE WHEN u.active THEN 'Aktif' ELSE 'Nonaktif' END, u.deactivated_at, 'iPad '||COALESCE(d.name,d.serial), NULL, NULL
    FROM app_user u JOIN pic_device pd ON pd.user_id=u.id JOIN device d ON d.id=pd.device_id
    ORDER BY 1`);
  const esc = (v) => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const csv = [['Nama', 'Email', 'Role', 'Status', 'Nonaktif sejak', 'Scope', 'Berlaku', 'Berakhir'].join(','),
    ...r.rows.map((x) => [x.name, x.email, x.role, x.status, x.deactivated_at, x.scope, x.start_date, x.end_date].map(esc).join(','))].join('\r\n');
  await audit(req, { action: 'Export review akses PIC' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="review_akses_pic_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\ufeff' + csv);
}));
