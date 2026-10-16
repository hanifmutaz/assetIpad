import type { NextFunction, Request, Response } from 'express';
import { one } from '../db.js';
import { cfg } from '../config.js';
import { safeEqual } from '../crypto.js';
import { forbidden, HttpError, unauth } from '../errors.js';
import { getRules } from '../services/rules.js';
import { can, type Perm } from '../services/policy.js';
import type { AuthUser } from '../types.js';

/** User dibaca ulang dari DB tiap request → nonaktif / ganti role langsung berlaku. */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const s = req.session;
    if (!s?.userId) return next();
    if (Date.now() - (s.loginAt ?? 0) > cfg.SESSION_MAX_HOURS * 3600e3) return s.destroy(() => next());
    const u = await one<AuthUser & { active: boolean }>(
      `SELECT u.id, u.email::text email, u.name, u.role, u.must_change_pw, u.phone, u.active,
              COALESCE(array_agg(ud.department_id) FILTER (WHERE ud.department_id IS NOT NULL), '{}') AS dept_ids
       FROM app_user u LEFT JOIN user_department ud ON ud.user_id=u.id WHERE u.id=$1 GROUP BY u.id`,
      [s.userId],
    );
    if (!u || !u.active) return s.destroy(() => next());
    req.user = { id: u.id, email: u.email, name: u.name, role: u.role, must_change_pw: u.must_change_pw, phone: u.phone, dept_ids: u.dept_ids };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauth());
  next();
}
/** Password awal / hasil reset admin wajib diganti sebelum memakai aplikasi. */
export function requirePwChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.must_change_pw) return next(new HttpError(403, 'Ganti password Anda terlebih dahulu', 'PW_CHANGE'));
  next();
}
export const requirePerm = (...perms: Perm[]) => (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) return next(unauth());
  if (!perms.some((p) => can(req.user, p))) return next(forbidden());
  next();
};

/** Anti-CSRF. Sesi login: token per sesi + Origin. Sebelum login: Origin + header custom. */
export function csrf(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== cfg.origin) return next(forbidden('Origin tidak diizinkan', 'CSRF'));
  if (req.session?.userId) {
    if (!safeEqual(req.get('x-csrf-token'), req.session.csrf)) return next(forbidden('Token keamanan tidak valid, muat ulang halaman', 'CSRF'));
  } else if (req.get('x-requested-with') !== 'fetch') {
    return next(forbidden('Permintaan tidak valid', 'CSRF'));
  }
  next();
}

/** Data rahasia: wajib konfirmasi ulang password akun dalam X menit terakhir (sliding). */
export async function requireStepUp(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const R = await getRules();
    if (!((req.session.stepUpUntil ?? 0) > Date.now())) return next(new HttpError(403, 'Konfirmasi password diperlukan', 'STEP_UP_REQUIRED'));
    req.session.stepUpUntil = Date.now() + R.lockMin * 60e3;
    next();
  } catch (e) {
    next(e);
  }
}
