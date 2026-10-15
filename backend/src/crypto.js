import crypto from 'node:crypto';
import { cfg } from './config.js';

/**
 * AES-256-GCM. Format: v1:<keyId>:<iv>:<tag>:<ciphertext>  (base64)
 * `context` (mis. "device:<uuid>:passcode") dipakai sebagai AAD → ciphertext tidak bisa
 * dipindah/ditukar ke baris lain tanpa ketahuan.
 */
export function encrypt(plain, context) {
  const id = cfg.activeKeyId;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cfg.dataKeys[id], iv);
  c.setAAD(Buffer.from(String(context)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', id, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(blob, context) {
  const [v, id, iv, tag, ct] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Format ciphertext tidak dikenal');
  const key = cfg.dataKeys[id];
  if (!key) throw new Error(`Kunci enkripsi "${id}" tidak tersedia`);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(String(context)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

export const keyIdOf = (blob) => String(blob).split(':')[1];

/** HMAC untuk cek duplikat (passcode sama di iPad lain) tanpa perlu dekripsi. */
export const hmac = (value, scope) => crypto.createHmac('sha256', cfg.hmacKey).update(`${scope}\u0000${value}`).digest('hex');

export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
