export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (msg, code = 'BAD_REQUEST', extra) => new HttpError(400, msg, code, extra);
export const forbidden = (msg = 'Akses ditolak', code = 'FORBIDDEN') => new HttpError(403, msg, code);
export const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

/** Bungkus handler async supaya error otomatis ke error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
