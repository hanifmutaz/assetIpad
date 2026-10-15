import { one } from '../db.js';
import { cfg } from '../config.js';
import { safeEqual } from '../crypto.js';
import { HttpError, forbidden } from '../errors.js';
import { getRules } from '../services/rules.js';

const USER_COLS = 'id, entra_oid, email::text AS email, name, role, active, phone, dept, notif';

/** Ambil user dari DB tiap request → perubahan role / nonaktif langsung berlaku. */
export async function loadUser(req, res, next) {
  try {
    const s = req.session;
    if (!s?.userId) return next();
    if (Date.now() - (s.loginAt || 0) > cfg.SESSION_MAX_HOURS * 3600e3) {
      return s.destroy(() => next());
    }
    const u = await one(`SELECT ${USER_COLS} FROM app_user WHERE id=$1`, [s.userId]);
    if (!u || !u.active) return s.destroy(() => next());
    req.user = u;
    next();
  } catch (e) {
    next(e);
  }
}

export const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Sesi berakhir, silakan login ulang', 'UNAUTH')));

export const requireRole = (...roles) => (req, res, next) =>
  !req.user ? next(new HttpError(401, 'Belum login', 'UNAUTH')) : roles.includes(req.user.role) ? next() : next(forbidden());

/** Anti-CSRF: request yang mengubah data wajib bawa header X-CSRF-Token + Origin yang sama. */
export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== cfg.origin) return next(forbidden('Origin tidak diizinkan', 'CSRF'));
  if (!safeEqual(req.get('x-csrf-token'), req.session?.csrf)) return next(forbidden('Token keamanan tidak valid, muat ulang halaman', 'CSRF'));
  next();
}

/** Data rahasia: wajib verifikasi ulang Microsoft dalam X menit terakhir (sliding). */
export async function requireStepUp(req, res, next) {
  try {
    const R = await getRules();
    if (!(req.session.stepUpUntil > Date.now())) {
      return next(new HttpError(403, 'Verifikasi ulang akun Microsoft diperlukan', 'STEP_UP_REQUIRED'));
    }
    req.session.stepUpUntil = Date.now() + R.lockMin * 60e3;
    next();
  } catch (e) {
    next(e);
  }
}
