import 'dotenv/config';
import { z } from 'zod';

const key32 = (name) => z.string().refine((s) => Buffer.from(s, 'base64').length === 32, `${name} harus 32 byte (base64)`);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),
  BASE_URL: z.string().url(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
  SESSION_IDLE_MIN: z.coerce.number().int().min(5).max(24 * 60).default(60),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(10),
  ENTRA_TENANT_ID: z.string().uuid('ENTRA_TENANT_ID harus GUID tenant'),
  ENTRA_CLIENT_ID: z.string().uuid('ENTRA_CLIENT_ID harus GUID aplikasi'),
  ENTRA_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL_DOMAINS: z.string().default(''),
  AUTO_PROVISION: z.enum(['true', 'false']).default('false'),
  DATA_KEYS: z.string().min(1),
  DATA_KEY_ACTIVE: z.string().min(1),
  HMAC_KEY: key32('HMAC_KEY'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(5),
  LOG_LEVEL: z.string().default('info'),
  DEV_LOGIN: z.enum(['true', 'false']).default('false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Konfigurasi .env tidak valid:\n' + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
const e = parsed.data;

const dataKeys = {};
for (const part of e.DATA_KEYS.split(',').map((s) => s.trim()).filter(Boolean)) {
  const idx = part.indexOf(':');
  const id = part.slice(0, idx);
  const buf = Buffer.from(part.slice(idx + 1), 'base64');
  if (idx < 1 || !/^[a-z0-9]{1,8}$/i.test(id) || buf.length !== 32) {
    console.error('DATA_KEYS tidak valid. Format: k1:<base64 32 byte>,k2:<base64 32 byte>');
    process.exit(1);
  }
  dataKeys[id] = buf;
}
if (!dataKeys[e.DATA_KEY_ACTIVE]) {
  console.error(`DATA_KEY_ACTIVE "${e.DATA_KEY_ACTIVE}" tidak ada di DATA_KEYS`);
  process.exit(1);
}

const isProd = e.NODE_ENV === 'production';
if (isProd && e.DEV_LOGIN === 'true') {
  console.error('DEV_LOGIN=true dilarang saat NODE_ENV=production');
  process.exit(1);
}
if (isProd && !e.BASE_URL.startsWith('https://')) {
  console.error('BASE_URL wajib https:// di production');
  process.exit(1);
}

export const cfg = {
  ...e,
  isProd,
  devLogin: e.DEV_LOGIN === 'true',
  autoProvision: e.AUTO_PROVISION === 'true',
  domains: e.ALLOWED_EMAIL_DOMAINS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  origin: new URL(e.BASE_URL).origin,
  redirectUri: new URL('/auth/redirect', e.BASE_URL).href,
  dataKeys,
  activeKeyId: e.DATA_KEY_ACTIVE,
  hmacKey: Buffer.from(e.HMAC_KEY, 'base64'),
  maxUploadBytes: Math.round(e.MAX_UPLOAD_MB * 1024 * 1024),
};
