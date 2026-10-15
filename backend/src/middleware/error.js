import { ZodError } from 'zod';
import { HttpError } from '../errors.js';
import { logger } from '../logger.js';

export function notFoundApi(req, res) {
  res.status(404).json({ error: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: `${first.path.join('.') || 'input'}: ${first.message}`, code: 'VALIDATION' });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Ukuran file terlalu besar', code: 'FILE_TOO_LARGE' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Data terlalu besar', code: 'TOO_LARGE' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Data sudah ada (duplikat)', code: 'DUPLICATE' });
  if (err?.code === '23503') return res.status(409).json({ error: 'Data masih dipakai / referensi tidak valid', code: 'FK' });
  if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22007') return res.status(400).json({ error: 'Format data tidak valid', code: 'INVALID' });
  logger.error({ err, url: req.originalUrl }, 'Unhandled error');
  res.status(500).json({ error: 'Terjadi kesalahan di server', code: 'SERVER' });
}
