import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, notFound } from '../errors.js';
import { requireStepUp } from '../middleware/auth.js';
import { assertCredField, credFieldsFor } from '../services/access.js';
import { audit, history } from '../services/audit.js';
import { readCredential, setCredential } from '../services/devices.js';
import { getMaster } from '../services/rules.js';
import { decrypt } from '../crypto.js';
import { CRED_FIELDS } from '../services/policy.js';

export const router = express.Router();
const uuid = z.string().uuid();
const limiter = rateLimit({ windowMs: 10 * 60e3, limit: 40, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'x', standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak akses data rahasia. Coba lagi nanti.', code: 'RATE' } });
const reason = z.string().refine(async (v) => (await getMaster('reason')).includes(v), 'Pilih alasan akses dari daftar');

router.get('/:id/credentials', requireStepUp, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const fields = await credFieldsFor(req.user!, id);
  if (!fields.length) { res.json([]); return; }
  const r = await q('SELECT field, enc, updated_at FROM device_credential WHERE device_id=$1', [id]);
  const by = Object.fromEntries(r.rows.map((x) => [x.field, x]));
  const out = fields.map((f) => {
    const m = CRED_FIELDS[f]!;
    return { field: f, label: m.label, sec: m.sec, kind: m.kind, set: !!by[f], updatedAt: by[f]?.updated_at ?? null, value: !m.sec && by[f] ? decrypt(by[f].enc, `device:${id}:${f}`) : null };
  });
  const shown = out.filter((x) => x.value).map((x) => x.label);
  if (shown.length) await audit(req, { action: 'Lihat', deviceId: id, target: shown.join(', '), reason: 'Buka tab credential' });
  res.json(out);
}));

router.post('/:id/credentials/:field/reveal', requireStepUp, limiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = String(req.params.field);
  await assertCredField(req.user!, id, field);
  const b = await z.object({ reason, mode: z.enum(['view', 'copy']).default('view') }).parseAsync(req.body);
  const value = await readCredential(id, field);
  if (!value) throw notFound('Credential belum diisi');
  await audit(req, { action: b.mode === 'copy' ? 'Salin' : 'Lihat', deviceId: id, target: CRED_FIELDS[field]!.label, reason: b.reason });
  res.json({ value });
}));

router.put('/:id/credentials/:field', requireStepUp, limiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = String(req.params.field);
  await assertCredField(req.user!, id, field);
  const b = await z.object({ value: z.string().min(1).max(200), reason }).parseAsync(req.body);
  await tx(async (c) => {
    await setCredential(c, id, field, b.value, req.user!.id);
    await history(c, id, req.user, `Credential diubah: ${CRED_FIELDS[field]!.label}`);
  });
  await audit(req, { action: 'Ubah', deviceId: id, target: CRED_FIELDS[field]!.label, reason: b.reason });
  res.json({ ok: true });
}));
