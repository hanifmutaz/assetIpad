import type { NextFunction, Request, Response, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR', public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const bad = (m: string, code = 'BAD_REQUEST') => new HttpError(400, m, code);
export const unauth = (m = 'Sesi berakhir, silakan login ulang') => new HttpError(401, m, 'UNAUTH');
export const forbidden = (m = 'Akses ditolak', code = 'FORBIDDEN') => new HttpError(403, m, code);
export const notFound = (m = 'Data tidak ditemukan') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m: string, code = 'CONFLICT') => new HttpError(409, m, code);

/** Bungkus handler async agar error otomatis diteruskan ke error handler. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
