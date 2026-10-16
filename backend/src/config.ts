import 'dotenv/config';
import { z } from 'zod';

const b64len = (n: number) => (s: string) => Buffer.from(s, 'base64').length === n;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),
  BASE_URL: z.string().url(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'minimal 32 karakter'),
  SESSION_IDLE_MIN: z.coerce.number().int().min(5).max(1440).default(60),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(10),
  DATA_KEYS: z.string().min(1),
  DATA_KEY_ACTIVE: z.string().min(1),
  HMAC_KEY: z.string().refine(b64len(32), 'harus 32 byte base64'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('iPad Asset Management <no-reply@localhost>'),
  ALLOWED_EMAIL_DOMAINS: z.string().default(''),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:\n' + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const e = parsed.data;

const dataKeys: Record<string, Buffer> = {};
for (const part of e.DATA_KEYS.split(',').map((s) => s.trim()).filter(Boolean)) {
  const i = part.indexOf(':');
  const id = part.slice(0, i);
  const buf = Buffer.from(part.slice(i + 1), 'base64');
  if (i < 1 || !/^[a-z0-9]{1,8}$/i.test(id) || buf.length !== 32) {
    console.error('DATA_KEYS tidak valid. Format: k1:<base64 32 byte>');
    process.exit(1);
  }
  dataKeys[id] = buf;
}
if (!dataKeys[e.DATA_KEY_ACTIVE]) {
  console.error(`DATA_KEY_ACTIVE "${e.DATA_KEY_ACTIVE}" tidak ada di DATA_KEYS`);
  process.exit(1);
}
const isProd = e.NODE_ENV === 'production';
const useHttps = e.BASE_URL.startsWith('https://');
if (isProd && !useHttps) console.warn('PERINGATAN: BASE_URL bukan https – login dikirim tanpa enkripsi. Pakai hanya di jaringan internal.');

export const cfg = {
  ...e,
  isProd,
  origin: new URL(e.BASE_URL).origin,
  domains: e.ALLOWED_EMAIL_DOMAINS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  dataKeys,
  activeKeyId: e.DATA_KEY_ACTIVE,
  hmacKey: Buffer.from(e.HMAC_KEY, 'base64'),
  maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
  smtpReady: !!e.SMTP_HOST,
  useHttps,
  cookieName: useHttps ? '__Host-ipad.sid' : 'ipad.sid',
};
