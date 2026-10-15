import express from 'express';
import rateLimit from 'express-rate-limit';
import { ConfidentialClientApplication, CryptoProvider, LogLevel } from '@azure/msal-node';
import { cfg } from '../config.js';
import { one, q } from '../db.js';
import { logger } from '../logger.js';
import { randomToken } from '../crypto.js';
import { audit } from '../services/audit.js';
import { getRules } from '../services/rules.js';
import { ah } from '../errors.js';
import { csrf } from '../middleware/auth.js';

const cca = new ConfidentialClientApplication({
  auth: {
    clientId: cfg.ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}`,
    clientSecret: cfg.ENTRA_CLIENT_SECRET,
  },
  system: {
    loggerOptions: {
      piiLoggingEnabled: false,
      logLevel: LogLevel.Warning,
      loggerCallback: (lvl, msg) => logger.warn({ msal: true }, msg),
    },
  },
});
const cp = new CryptoProvider();
const SCOPES = ['openid', 'profile', 'email'];
const FLOW_TTL = 10 * 60e3;

const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
export const router = express.Router();
router.use(limiter);

/** Hanya izinkan redirect ke path internal (cegah open redirect). */
const safeReturn = (p) => (typeof p === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(p) && !p.startsWith('/auth') ? p : '/');
const fail = (res, code) => res.redirect(`/login?error=${encodeURIComponent(code)}`);
const regenerate = (req) => new Promise((ok, no) => req.session.regenerate((e) => (e ? no(e) : ok())));
const saveSession = (req) => new Promise((ok, no) => req.session.save((e) => (e ? no(e) : ok())));

async function startFlow(req, res, { mode, returnTo, popup, prompt, loginHint }) {
  const { verifier, challenge } = await cp.generatePkceCodes();
  const state = randomToken(24);
  const nonce = randomToken(24);
  req.session.authFlow = { state, nonce, verifier, mode, popup: !!popup, returnTo: safeReturn(returnTo), at: Date.now() };
  await saveSession(req);
  const url = await cca.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: cfg.redirectUri,
    responseMode: 'query',
    state,
    nonce,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    prompt,
    loginHint,
  });
  res.redirect(url);
}

router.get('/login', ah(async (req, res) => startFlow(req, res, { mode: 'login', returnTo: req.query.returnTo, prompt: 'select_account' })));

// Verifikasi ulang (step-up) sebelum membuka data rahasia. Bisa via popup.
router.get('/stepup', ah(async (req, res) => {
  if (!req.user) return fail(res, 'session');
  await startFlow(req, res, { mode: 'stepup', returnTo: req.query.returnTo, popup: req.query.popup === '1', prompt: 'login', loginHint: req.user.email });
}));

router.get('/redirect', ah(async (req, res) => {
  const f = req.session.authFlow;
  delete req.session.authFlow;
  if (req.query.error) {
    logger.warn({ err: req.query.error, desc: String(req.query.error_description || '').slice(0, 200) }, 'Login Microsoft ditolak');
    return fail(res, 'ms_error');
  }
  if (!f || typeof req.query.state !== 'string' || req.query.state !== f.state || Date.now() - f.at > FLOW_TTL) return fail(res, 'state');

  let result;
  try {
    result = await cca.acquireTokenByCode({ code: String(req.query.code || ''), scopes: SCOPES, redirectUri: cfg.redirectUri, codeVerifier: f.verifier });
  } catch (e) {
    logger.warn({ err: e.errorCode || e.message }, 'Tukar kode gagal');
    return fail(res, 'ms_error');
  } finally {
    // token tidak disimpan – aplikasi hanya butuh identitas
  }
  if (result?.account) await cca.getTokenCache().removeAccount(result.account).catch(() => {});

  const c = result?.idTokenClaims || {};
  if (c.nonce !== f.nonce) return fail(res, 'state');
  if (c.tid !== cfg.ENTRA_TENANT_ID) return fail(res, 'tenant');
  const oid = c.oid;
  const email = String(c.preferred_username || c.email || c.upn || '').toLowerCase();
  if (!oid || !email) return fail(res, 'ms_error');
  if (cfg.domains.length && !cfg.domains.includes(email.split('@')[1])) return fail(res, 'domain');

  // ---- step-up: harus akun yang sama dengan sesi aktif
  if (f.mode === 'stepup') {
    if (!req.user || req.user.entra_oid !== oid) return fail(res, 'stepup_mismatch');
    const R = await getRules();
    req.session.stepUpUntil = Date.now() + R.lockMin * 60e3;
    await audit(req, { action: 'Verifikasi ulang (step-up)', reason: 'Microsoft' });
    await saveSession(req);
    return f.popup ? res.redirect('/stepup-done.html?ok=1') : res.redirect(f.returnTo);
  }

  // ---- login: cari user yg sudah didaftarkan admin (by oid, lalu by email utk login pertama)
  let u = await one('SELECT id, active, entra_oid FROM app_user WHERE entra_oid=$1', [oid]);
  if (!u) {
    u = await one('SELECT id, active, entra_oid FROM app_user WHERE email=$1', [email]);
    if (u && u.entra_oid && u.entra_oid !== oid) return fail(res, 'not_registered');
    if (u) await q('UPDATE app_user SET entra_oid=$1 WHERE id=$2', [oid, u.id]);
  }
  if (!u && cfg.autoProvision) {
    u = await one(`INSERT INTO app_user(entra_oid,email,name,role) VALUES($1,$2,$3,'user') RETURNING id, active`, [oid, email, String(c.name || email).slice(0, 120)]);
  }
  if (!u) {
    logger.warn({ email }, 'Login ditolak: belum terdaftar');
    return fail(res, 'not_registered');
  }
  if (!u.active) return fail(res, 'inactive');

  await regenerate(req); // cegah session fixation
  req.session.userId = u.id;
  req.session.loginAt = Date.now();
  req.session.csrf = randomToken();
  await q('UPDATE app_user SET last_login_at=now(), name=COALESCE(NULLIF($2,\'\'), name) WHERE id=$1', [u.id, String(c.name || '').slice(0, 120)]);
  req.user = await one('SELECT id, email::text email, name, role FROM app_user WHERE id=$1', [u.id]);
  await audit(req, { action: 'Login', reason: 'Microsoft' });
  await saveSession(req);
  res.redirect(f.returnTo);
}));

router.post('/logout', csrf, ah(async (req, res) => {
  if (req.user) await audit(req, { action: 'Logout' }).catch(() => {});
  req.session.destroy(() => {
    res.clearCookie(cfg.isProd ? '__Host-ipad.sid' : 'ipad.sid', { path: '/' });
    const post = encodeURIComponent(new URL('/login', cfg.BASE_URL).href);
    res.json({ logoutUrl: `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=${post}` });
  });
}));

router.get('/config', (req, res) => res.json({ devLogin: cfg.devLogin }));

// ---- Development saja: login tanpa Microsoft (ditolak saat production)
if (cfg.devLogin && !cfg.isProd) {
  logger.warn('DEV_LOGIN aktif – jangan dipakai di production');
  router.post('/dev-login', express.json(), ah(async (req, res) => {
    const u = await one('SELECT id, active FROM app_user WHERE email=$1', [String(req.body?.email || '').toLowerCase()]);
    if (!u || !u.active) return res.status(403).json({ error: 'User tidak terdaftar / nonaktif' });
    await regenerate(req);
    Object.assign(req.session, { userId: u.id, loginAt: Date.now(), csrf: randomToken() });
    await saveSession(req);
    res.json({ ok: true });
  }));
  router.post('/dev-stepup', csrf, ah(async (req, res) => {
    if (!req.user) return res.status(401).end();
    req.session.stepUpUntil = Date.now() + (await getRules()).lockMin * 60e3;
    res.json({ ok: true });
  }));
}
