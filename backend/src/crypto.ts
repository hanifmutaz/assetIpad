import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cfg } from './config.js';

const scryptAsync = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opt: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Hash password akun aplikasi (scrypt bawaan Node, tanpa modul native). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const h = await scryptAsync(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Tetap kerjakan hash walau user tidak ada → waktu respons sama (anti enumerasi)
  const parts = (stored ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const [alg, N, r, p, salt, hash] = parts;
  if (alg !== 'scrypt' || !salt) return false;
  const h = await scryptAsync(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), 64, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  const want = Buffer.from(hash ?? '', 'base64');
  return want.length === h.length && crypto.timingSafeEqual(h, want) && !!stored;
}

/** AES-256-GCM, format v1:<keyId>:<iv>:<tag>:<ct>. `context` jadi AAD supaya ciphertext tak bisa dipindah ke baris lain. */
export function encrypt(plain: string, context: string): string {
  const id = cfg.activeKeyId;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cfg.dataKeys[id]!, iv);
  c.setAAD(Buffer.from(context));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', id, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function decrypt(blob: string, context: string): string {
  const [v, id, iv, tag, ct] = blob.split(':');
  const key = id ? cfg.dataKeys[id] : undefined;
  if (v !== 'v1' || !key || !iv || !tag || !ct) throw new Error('Ciphertext tidak valid / kunci tidak tersedia');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(context));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
export const keyIdOf = (blob: string) => blob.split(':')[1];
export const hmac = (value: string, scope: string) => crypto.createHmac('sha256', cfg.hmacKey).update(`${scope}\u0000${value}`).digest('hex');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export function safeEqual(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
