import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, notFound } from '../errors.js';
import { requireStepUp } from '../middleware/auth.js';
import { assertCredField, credFieldsFor } from '../services/access.js';
import { audit, history } from '../services/audit.js';
import { readCredential, setCredential } from '../services/devices.js';
import { decrypt } from '../crypto.js';
import { CRED_FIELDS, getMasterReasons } from '../services/creds-helpers.js';

export const router = express.Router();
const uuid = z.string().uuid();
const secretLimiter = rateLimit({ windowMs: 10 * 60e3, limit: 40, keyGenerator: (req) => req.user.id, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak akses data rahasia. Coba lagi nanti.', code: 'RATE' } });

const reasonSchema = async () => z.string().refine(async (v) => (await getMasterReasons()).includes(v), 'Pilih alasan akses dari daftar');

// daftar credential (non-rahasia ditampilkan, rahasia hanya status "terisi")
router.get('/:id/credentials', requireStepUp, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const fields = await credFieldsFor(req.user, id);
  if (!fields.length) return res.json([]);
  const r = await q('SELECT field, enc, updated_at FROM device_credential WHERE device_id=$1', [id]);
  const by = Object.fromEntries(r.rows.map((x) => [x.field, x]));
  const out = fields.map((f) => ({
    field: f, label: CRED_FIELDS[f].label, sec: CRED_FIELDS[f].sec, set: !!by[f], updatedAt: by[f]?.updated_at || null,
    value: !CRED_FIELDS[f].sec && by[f] ? decrypt(by[f].enc, `device:${id}:${f}`) : null,
  }));
  const shown = out.filter((x) => x.value).map((x) => x.label);
  if (shown.length) await audit(req, { action: 'Lihat', deviceId: id, target: shown.join(', '), reason: 'Buka tab credential' });
  res.json(out);
}));

router.post('/:id/credentials/:field/reveal', requireStepUp, secretLimiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = req.params.field;
  await assertCredField(req.user, id, field);
  const b = await z.object({ reason: await reasonSchema(), mode: z.enum(['view', 'copy']).default('view') }).parseAsync(req.body);
  const value = await readCredential(id, field);
  if (!value) throw notFound('Credential belum diisi');
  await audit(req, { action: b.mode === 'copy' ? 'Salin' : 'Lihat', deviceId: id, target: CRED_FIELDS[field].label, reason: b.reason });
  res.json({ value });
}));

router.put('/:id/credentials/:field', requireStepUp, secretLimiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = req.params.field;
  await assertCredField(req.user, id, field);
  const b = await z.object({ value: z.string().min(1).max(200), reason: await reasonSchema() }).parseAsync(req.body);
  await tx(async (c) => {
    await setCredential(c, id, field, b.value, req.user.id);
    await history(c, id, req.user, `Credential diubah: ${CRED_FIELDS[field].label}`);
  });
  await audit(req, { action: 'Ubah', deviceId: id, target: CRED_FIELDS[field].label, reason: b.reason });
  res.json({ ok: true });
}));
