import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors.js';
import { logger } from '../logger.js';

export function notFoundApi(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Endpoint tidak ditemukan', code: 'NOT_FOUND' });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const f = err.issues[0];
    res.status(400).json({ error: `${f?.path.join('.') || 'input'}: ${f?.message ?? 'tidak valid'}`, code: 'VALIDATION', field: f?.path.join('.') });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra ?? {}) });
    return;
  }
  const e = err as { code?: string; type?: string };
  const map: Record<string, [number, string]> = {
    LIMIT_FILE_SIZE: [400, 'Ukuran file terlalu besar'],
    '23505': [409, 'Data sudah ada (duplikat)'],
    '23503': [409, 'Data masih dipakai / referensi tidak valid'],
    '23514': [400, 'Format data tidak valid'],
    '22P02': [400, 'Format data tidak valid'],
  };
  const hit = (e.code && map[e.code]) || (e.type === 'entity.too.large' ? [413, 'Data terlalu besar'] as [number, string] : null);
  if (hit) {
    res.status(hit[0]).json({ error: hit[1], code: e.code ?? 'INVALID' });
    return;
  }
  logger.error({ err, url: req.originalUrl }, 'Unhandled error');
  res.status(500).json({ error: 'Terjadi kesalahan di server', code: 'SERVER' });
}
