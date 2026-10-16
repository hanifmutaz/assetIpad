// Akun lokal dikelola Super Admin. Password sementara ditampilkan sekali dan wajib diganti saat login pertama.
import express from 'express';
import { z } from 'zod';
import { q, tx, type Db } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { ROLES } from '../services/policy.js';
import { cfg } from '../config.js';
import { hashPassword, randomToken } from '../crypto.js';
import { sendMail } from '../mail.js';
import { logger } from '../logger.js';

export const router = express.Router();
router.use(requirePerm('users.manage'));
const uuid = z.string().uuid();
const tempPassword = () => randomToken(9).replace(/[-_]/g, 'x'); // 12 karakter acak

async function assertSuperRemains(c: Db, exceptId: string) {
  const r = await c.query("SELECT count(*)::int n FROM app_user WHERE role='superadmin' AND active AND id<>$1", [exceptId]);
  if ((r.rows[0]?.n ?? 0) < 1) throw conflict('Minimal harus ada 1 Super Admin aktif');
}
async function notify(email: string, name: string, pw: string) {
  await sendMail(email, 'Akun iPad Asset Management',
    `Halo ${name},\n\nAkun Anda sudah dibuat / direset.\nLogin: ${cfg.BASE_URL}/login\nEmail: ${email}\nPassword sementara: ${pw}\n\nAnda wajib mengganti password saat login pertama.`)
    .catch((e) => logger.error(e, 'Gagal kirim email akun'));
}

router.get('/', ah(async (_req, res) => {
  const u = await q(`SELECT u.id, u.email::text email, u.name, u.role, u.active, u.phone, u.must_change_pw, u.deactivated_at, u.deactivated_reason, u.last_login_at,
      (u.locked_until > now()) AS locked, COALESCE(array_agg(ud.department_id) FILTER (WHERE ud.department_id IS NOT NULL), '{}') dept_ids
    FROM app_user u LEFT JOIN user_department ud ON ud.user_id=u.id GROUP BY u.id ORDER BY u.active DESC, u.name`);
  const orphans = await q(`SELECT dp.name, count(d.id)::int n FROM department dp JOIN device d ON d.department_id=dp.id AND d.status IN ('Setup','Available','Repair')
    WHERE NOT EXISTS (SELECT 1 FROM user_department ud JOIN app_user u ON u.id=ud.user_id AND u.active AND u.role='admin_dept' WHERE ud.department_id=dp.id)
    GROUP BY dp.id ORDER BY dp.name`);
  res.json({ users: u.rows, orphans: orphans.rows, smtp: cfg.smtpReady });
}));

router.post('/', ah(async (req, res) => {
  const b = z.object({ email: z.string().trim().toLowerCase().email().max(160), name: z.string().trim().min(1).max(120), role: z.enum(ROLES),
    departmentIds: z.array(z.number().int()).max(50).default([]), sendEmail: z.boolean().default(true) }).parse(req.body);
  if (cfg.domains.length && !cfg.domains.includes(b.email.split('@')[1] ?? '')) throw bad(`Email harus domain ${cfg.domains.join(', ')}`);
  if (b.role === 'admin_dept' && !b.departmentIds.length) throw bad('Admin Department wajib punya minimal 1 department');
  const pw = tempPassword();
  const id = await tx(async (c) => {
    const r = await c.query('INSERT INTO app_user(email,name,role,pw_hash,must_change_pw) VALUES($1,$2,$3,$4,true) RETURNING id', [b.email, b.name, b.role, await hashPassword(pw)]);
    for (const d of b.departmentIds) await c.query('INSERT INTO user_department(user_id,department_id) VALUES($1,$2)', [r.rows[0].id, d]);
    return r.rows[0].id as string;
  });
  if (b.sendEmail) await notify(b.email, b.name, pw);
  await audit(req, { action: 'Tambah user', target: `${b.email} (${b.role})` });
  res.status(201).json({ id, tempPassword: pw, emailed: b.sendEmail && cfg.smtpReady });
}));

router.patch('/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ role: z.enum(ROLES).optional(), name: z.string().trim().min(1).max(120).optional(), departmentIds: z.array(z.number().int()).max(50).optional() }).parse(req.body);
  await tx(async (c) => {
    const u = (await c.query('SELECT role FROM app_user WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!u) throw notFound();
    if (b.role && b.role !== 'superadmin' && u.role === 'superadmin') {
      if (id === req.user!.id) throw bad('Tidak bisa menurunkan role akun sendiri');
      await assertSuperRemains(c, id);
    }
    await c.query('UPDATE app_user SET role=COALESCE($2,role), name=COALESCE($3,name) WHERE id=$1', [id, b.role ?? null, b.name ?? null]);
    if (b.departmentIds) {
      await c.query('DELETE FROM user_department WHERE user_id=$1', [id]);
      for (const d of b.departmentIds) await c.query('INSERT INTO user_department(user_id,department_id) VALUES($1,$2)', [id, d]);
    }
    const nu = (await c.query('SELECT role FROM app_user WHERE id=$1', [id])).rows[0];
    if (nu.role === 'admin_dept' && !(await c.query('SELECT 1 FROM user_department WHERE user_id=$1', [id])).rowCount) throw bad('Admin Department wajib punya minimal 1 department');
  });
  await audit(req, { action: 'Ubah user', target: `${id}${b.role ? ` role=${b.role}` : ''}${b.departmentIds ? ` dept=${b.departmentIds.join(',')}` : ''}` });
  res.json({ ok: true });
}));

router.post('/:id/reset-password', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const u = (await q('SELECT email::text email, name FROM app_user WHERE id=$1', [id])).rows[0];
  if (!u) throw notFound();
  const pw = tempPassword();
  await q('UPDATE app_user SET pw_hash=$2, must_change_pw=true, failed_count=0, locked_until=NULL WHERE id=$1', [id, await hashPassword(pw)]);
  await q("DELETE FROM session WHERE (sess->>'userId') = $1", [id]);
  await notify(u.email, u.name, pw);
  await audit(req, { action: 'Reset password user (admin)', target: u.email });
  res.json({ tempPassword: pw, emailed: cfg.smtpReady });
}));

router.post('/:id/unlock', ah(async (req, res) => {
  await q('UPDATE app_user SET failed_count=0, locked_until=NULL WHERE id=$1', [uuid.parse(req.params.id)]);
  await audit(req, { action: 'Buka kunci akun', target: String(req.params.id) });
  res.json({ ok: true });
}));

router.post('/:id/deactivate', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ reason: z.string().trim().min(1).max(120) }).parse(req.body);
  if (id === req.user!.id) throw bad('Tidak bisa menonaktifkan akun sendiri');
  await tx(async (c) => {
    await assertSuperRemains(c, id);
    const r = await c.query('UPDATE app_user SET active=false, deactivated_at=current_date, deactivated_reason=$2 WHERE id=$1', [id, b.reason]);
    if (!r.rowCount) throw notFound();
    await c.query("DELETE FROM session WHERE (sess->>'userId') = $1", [id]);
  });
  await audit(req, { action: 'Nonaktifkan user', target: id, reason: b.reason });
  res.json({ ok: true });
}));
router.post('/:id/activate', ah(async (req, res) => {
  await q('UPDATE app_user SET active=true, deactivated_at=NULL, deactivated_reason=NULL WHERE id=$1', [uuid.parse(req.params.id)]);
  await audit(req, { action: 'Aktifkan user', target: String(req.params.id) });
  res.json({ ok: true });
}));
