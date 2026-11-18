import express, { type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { ah, bad, unauth } from '../errors.js';
import { cfg } from '../config.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../crypto.js';
import { audit } from '../services/audit.js';
import { revokeAccountAccess } from '../services/account-sessions.js';
import type { Role } from '../types.js';
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
interface LoginRow { id: string; name: string; role: Role; pw_hash: string | null; active: boolean; locked_until: Date | null }

router.post('/login', limit(20, 15), ah(async (req, res) => {
  const b = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
  const u = await one<LoginRow>('SELECT id,name,role,pw_hash,active,locked_until FROM app_user WHERE email=$1', [b.email]);
  if (u?.locked_until && u.locked_until.getTime() > Date.now()) {
    throw bad('Akun dikunci sementara. Coba lagi setelah '+LOCK_MIN+' menit.', 'LOCKED');
  }
  const ok = await verifyPassword(b.password, u?.pw_hash ?? null);
  if (!u || !u.active || !ok) {
    if (u?.active) await tx(async (c) => {
      const failed = await c.query<{ locked: boolean }>(`
        UPDATE app_user
        SET failed_count=CASE WHEN failed_count+1 >= $3 THEN 0 ELSE failed_count+1 END,
            locked_until=CASE WHEN failed_count+1 >= $3 THEN now()+make_interval(mins => $4) ELSE NULL END
        WHERE id=$1 AND pw_hash IS NOT DISTINCT FROM $2 AND active AND (locked_until IS NULL OR locked_until<=now())
        RETURNING locked_until IS NOT NULL AS locked`, [u.id, u.pw_hash, MAX_FAIL, LOCK_MIN]);
      if (failed.rowCount) await audit(req, { action: failed.rows[0]?.locked ? 'Login gagal, akun dikunci sementara' : 'Login gagal', target: b.email }, c, u);
    });
    throw unauth(u && !u.active && ok ? 'Akun Anda dinonaktifkan. Hubungi Super Admin.' : 'Email atau password salah');
  }
  const session = await tx(async (c) => {
    const result = await c.query<{ credential_version: number; must_change_pw: boolean }>(`
      UPDATE app_user SET failed_count=0, locked_until=NULL, last_login_at=now()
      WHERE id=$1 AND pw_hash=$2 AND active AND (locked_until IS NULL OR locked_until<=now())
      RETURNING credential_version, must_change_pw`, [u.id, u.pw_hash]);
    if (!result.rows[0]) throw unauth('Login gagal. Coba lagi nanti.');
    await audit(req, { action: 'Login' }, c, u);
    return result.rows[0];
  });
  await regenerate(req);
  req.session.userId = u.id;
  req.session.loginAt = Date.now();
  req.session.credentialVersion = session.credential_version;
  req.session.csrf = randomToken();
  await saveSession(req);
  res.json({ ok: true, mustChange: session.must_change_pw });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.user) await audit(req, { action: 'Logout' }).catch(() => undefined);
  if (req.session) await new Promise<void>((resolve, reject) => req.session.destroy((err) => err ? reject(err) : resolve()));
  res.clearCookie(cfg.cookieName, { path: '/', secure: cfg.useHttps, httpOnly: true, sameSite: 'strict' });
  res.json({ ok: true });
}));

// Lupa password: jawaban selalu sama (tidak membocorkan email terdaftar atau tidak)
router.post('/forgot', limit(5, 60), ah(async (req, res) => {
  const b = z.object({ email }).parse(req.body);
  const token = randomToken(32);
  const u = await tx(async (c) => {
    const found = (await c.query<{ id: string; name: string; role: Role }>('SELECT id,name,role FROM app_user WHERE email=$1 AND active FOR UPDATE', [b.email])).rows[0];
    if (found) await c.query("INSERT INTO password_reset(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')", [sha256(token), found.id]);
    return found;
  });
  if (u) {
    const link = new URL(`/reset-password?token=${encodeURIComponent(token)}`, cfg.BASE_URL).href;
    await sendMail(b.email, 'Reset password iPad Asset Management',
      `Halo ${u.name},\n\nKlik link berikut untuk membuat password baru (berlaku 30 menit, sekali pakai):\n${link}\n\nAbaikan email ini jika Anda tidak memintanya.`)
      .catch((e) => logger.error(e, 'Gagal kirim email reset'));
    await audit(req, { action: 'Minta reset password', target: b.email }, undefined, u);
  }
  res.json({ ok: true, message: 'Jika email terdaftar, link reset sudah dikirim. Cek inbox Anda.' });
}));

router.post('/reset', limit(10, 15), ah(async (req, res) => {
  const b = z.object({ token: z.string().min(20).max(100), password: z.string().max(200) }).parse(req.body);
  await tx(async (c) => {
    const token = sha256(b.token);
    const match = (await c.query<{ user_id: string }>('SELECT user_id FROM password_reset WHERE token_hash=$1', [token])).rows[0];
    const u = match ? (await c.query<{ id: string; email: string; name: string; role: Role }>(
      'SELECT id,email::text,name,role FROM app_user WHERE id=$1 AND active FOR UPDATE', [match.user_id])).rows[0] : null;
    if (!u || !(await c.query('SELECT 1 FROM password_reset WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()', [token])).rowCount) {
      throw bad('Link reset tidak valid atau sudah kedaluwarsa. Minta link baru.', 'TOKEN');
    }
    const p = accountPasswordProblem(b.password, u.email);
    if (p) throw bad(p, 'WEAK_PASSWORD');
    await c.query('UPDATE app_user SET pw_hash=$2, must_change_pw=false, pw_changed_at=now(), failed_count=0, locked_until=NULL, credential_version=credential_version+1 WHERE id=$1', [u.id, await hashPassword(b.password)]);
    await revokeAccountAccess(c, u.id);
    await audit(req, { action: 'Reset password via email' }, c, u);
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
  const userId = req.user.id;
  const nextHash = await hashPassword(b.password);
  const version = await tx(async (c) => {
    const r = await c.query<{ credential_version: number }>(
      'UPDATE app_user SET pw_hash=$2, must_change_pw=false, pw_changed_at=now(), failed_count=0, locked_until=NULL, credential_version=credential_version+1 WHERE id=$1 AND pw_hash=$3 AND active RETURNING credential_version',
      [userId, nextHash, u?.pw_hash]);
    if (!r.rows[0]) throw unauth();
    await revokeAccountAccess(c, userId, req.sessionID);
    await audit(req, { action: 'Ganti password' }, c);
    return r.rows[0].credential_version;
  });
  req.session.credentialVersion = version;
  delete req.session.stepUpUntil;
  await saveSession(req);
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
