import express, { type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { ah, bad, unauth } from '../errors.js';
import { cfg } from '../config.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../crypto.js';
import { audit } from '../services/audit.js';
import { getRules } from '../services/rules.js';
import { accountPasswordProblem } from '../services/policy.js';
import { sendMail } from '../mail.js';
import { logger } from '../logger.js';

export const router = express.Router();
const MAX_FAIL = 5;
const LOCK_MIN = 15;
const email = z.string().trim().toLowerCase().email().max(160);
const limit = (n: number, min: number) => rateLimit({ windowMs: min * 60e3, limit: n, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Terlalu banyak percobaan, coba lagi nanti', code: 'RATE' } });
const regenerate = (req: Request) => new Promise<void>((ok, no) => req.session.regenerate((e) => (e ? no(e) : ok())));
const saveSession = (req: Request) => new Promise<void>((ok, no) => req.session.save((e) => (e ? no(e) : ok())));
const killSessions = (userId: string, exceptSid?: string) =>
  q("DELETE FROM session WHERE (sess->>'userId') = $1 AND ($2::text IS NULL OR sid <> $2)", [userId, exceptSid ?? null]);

interface LoginRow { id: string; name: string; role: 'superadmin' | 'admin_ipad' | 'admin_dept'; pw_hash: string | null; active: boolean; failed_count: number; locked_until: string | null; must_change_pw: boolean }

router.post('/login', limit(20, 15), ah(async (req, res) => {
  const b = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
  const u = await one<LoginRow>('SELECT id,name,role,pw_hash,active,failed_count,locked_until,must_change_pw FROM app_user WHERE email=$1', [b.email]);
  if (u?.locked_until && new Date(u.locked_until) > new Date()) {
    throw bad(`Akun dikunci sementara karena terlalu banyak percobaan. Coba lagi setelah ${LOCK_MIN} menit.`, 'LOCKED');
  }
  const ok = await verifyPassword(b.password, u?.pw_hash ?? null);
  if (!u || !ok || !u.active) {
    if (u) {
      const n = u.failed_count + 1;
      await q('UPDATE app_user SET failed_count=$2, locked_until = CASE WHEN $2 >= $3 THEN now() + make_interval(mins => $4) ELSE NULL END WHERE id=$1', [u.id, n >= MAX_FAIL ? 0 : n, MAX_FAIL, LOCK_MIN]);
      await audit(req, { action: n >= MAX_FAIL ? 'Login gagal – akun dikunci sementara' : 'Login gagal', target: b.email }, undefined, u);
    }
    throw unauth(u && !u.active && ok ? 'Akun Anda dinonaktifkan. Hubungi Super Admin.' : 'Email atau password salah');
  }
  await regenerate(req);
  req.session.userId = u.id;
  req.session.loginAt = Date.now();
  req.session.csrf = randomToken();
  await q('UPDATE app_user SET failed_count=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
  await audit(req, { action: 'Login' }, undefined, u);
  await saveSession(req);
  res.json({ ok: true, mustChange: u.must_change_pw });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, { action: 'Logout' }).catch(() => undefined);
  req.session.destroy(() => {
    res.clearCookie(cfg.cookieName, { path: '/' });
    res.json({ ok: true });
  });
}));

// Lupa password: jawaban selalu sama (tidak membocorkan email terdaftar atau tidak)
router.post('/forgot', limit(5, 60), ah(async (req, res) => {
  const b = z.object({ email }).parse(req.body);
  const u = await one<{ id: string; name: string }>('SELECT id,name FROM app_user WHERE email=$1 AND active', [b.email]);
  if (u) {
    const token = randomToken(32);
    await q('INSERT INTO password_reset(token_hash,user_id,expires_at) VALUES($1,$2, now() + interval \'30 minutes\')', [sha256(token), u.id]);
    const link = new URL(`/reset-password?token=${encodeURIComponent(token)}`, cfg.BASE_URL).href;
    await sendMail(b.email, 'Reset password iPad Asset Management',
      `Halo ${u.name},\n\nKlik link berikut untuk membuat password baru (berlaku 30 menit, sekali pakai):\n${link}\n\nAbaikan email ini jika Anda tidak memintanya.`)
      .catch((e) => logger.error(e, 'Gagal kirim email reset'));
    await audit(req, { action: 'Minta reset password', target: b.email }, undefined, { id: u.id, name: u.name, role: 'admin_dept' });
  }
  res.json({ ok: true, message: 'Jika email terdaftar, link reset sudah dikirim. Cek inbox Anda.' });
}));

router.post('/reset', limit(10, 15), ah(async (req, res) => {
  const b = z.object({ token: z.string().min(20).max(100), password: z.string().max(200) }).parse(req.body);
  await tx(async (c) => {
    const r = (await c.query(
      `SELECT pr.user_id, u.email::text email, u.name FROM password_reset pr JOIN app_user u ON u.id=pr.user_id
       WHERE pr.token_hash=$1 AND pr.used_at IS NULL AND pr.expires_at > now() AND u.active FOR UPDATE OF pr`, [sha256(b.token)])).rows[0] as { user_id: string; email: string; name: string } | undefined;
    if (!r) throw bad('Link reset tidak valid atau sudah kedaluwarsa. Minta link baru.', 'TOKEN');
    const p = accountPasswordProblem(b.password, r.email);
    if (p) throw bad(p, 'WEAK_PASSWORD');
    await c.query('UPDATE password_reset SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [r.user_id]);
    await c.query('UPDATE app_user SET pw_hash=$2, must_change_pw=false, pw_changed_at=now(), failed_count=0, locked_until=NULL WHERE id=$1', [r.user_id, await hashPassword(b.password)]);
    await c.query("DELETE FROM session WHERE (sess->>'userId') = $1", [r.user_id]);
    await audit(req, { action: 'Reset password via email' }, c, { id: r.user_id, name: r.name, role: 'admin_dept' });
  });
  res.json({ ok: true });
}));

router.post('/change-password', limit(10, 15), ah(async (req, res) => {
  if (!req.user) throw unauth();
  const b = z.object({ current: z.string().max(200), password: z.string().max(200) }).parse(req.body);
  const u = await one<{ pw_hash: string }>('SELECT pw_hash FROM app_user WHERE id=$1', [req.user.id]);
  if (!(await verifyPassword(b.current, u?.pw_hash ?? null))) throw bad('Password saat ini salah', 'WRONG_PASSWORD');
  if (b.current === b.password) throw bad('Password baru harus berbeda');
  const p = accountPasswordProblem(b.password, req.user.email);
  if (p) throw bad(p, 'WEAK_PASSWORD');
  await q('UPDATE app_user SET pw_hash=$2, must_change_pw=false, pw_changed_at=now() WHERE id=$1', [req.user.id, await hashPassword(b.password)]);
  await killSessions(req.user.id, req.sessionID);
  await audit(req, { action: 'Ganti password' });
  res.json({ ok: true });
}));

// Konfirmasi ulang password sebelum membuka data rahasia
router.post('/step-up', limit(10, 15), ah(async (req, res) => {
  if (!req.user) throw unauth();
  const b = z.object({ password: z.string().max(200) }).parse(req.body);
  const u = await one<{ pw_hash: string }>('SELECT pw_hash FROM app_user WHERE id=$1', [req.user.id]);
  if (!(await verifyPassword(b.password, u?.pw_hash ?? null))) {
    await audit(req, { action: 'Konfirmasi password gagal' });
    throw bad('Password salah', 'WRONG_PASSWORD');
  }
  req.session.stepUpUntil = Date.now() + (await getRules()).lockMin * 60e3;
  await audit(req, { action: 'Konfirmasi password (buka data rahasia)' });
  res.json({ ok: true });
}));
