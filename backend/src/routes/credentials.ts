import express, { type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx } from '../db.js';
import { ah, bad, notFound } from '../errors.js';
import { requirePerm, requireStepUp } from '../middleware/auth.js';
import { assertCredField, assertDeviceVisible, credFieldsFor, deviceScope } from '../services/access.js';
import { audit, history } from '../services/audit.js';
import { readCredential, setCredential } from '../services/devices.js';
import { getMaster } from '../services/rules.js';
import { decrypt } from '../crypto.js';
import { can, CRED_FIELDS } from '../services/policy.js';

export const router = express.Router();
const uuid = z.string().uuid();
const limiter = rateLimit({ windowMs: 10 * 60e3, limit: 40, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'x', standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak akses data rahasia. Coba lagi nanti.', code: 'RATE' } });
const reasonInput = z.object({
  reason: z.string().trim().refine(async (v) => (await getMaster('reason')).includes(v), 'Pilih alasan akses dari daftar'),
  reasonDetail: z.string().trim().max(500).optional(),
});

async function auditReason(input: unknown): Promise<string> {
  const { reason, reasonDetail } = await reasonInput.parseAsync(input);
  if (reason.toLowerCase() !== 'lainnya') return reason;
  if (!reasonDetail) throw bad('Keterangan wajib diisi jika memilih alasan Lainnya.', 'REASON_DETAIL_REQUIRED');
  return reason + ' · ' + reasonDetail;
}

const includesValues = (req: Request) => req.query.metadata !== '1' && can(req.user, 'cred.all');
const requireStepUpForValues: RequestHandler = (req, res, next) => {
  if (includesValues(req)) return requireStepUp(req, res, next);
  next();
};

router.get('/:id/credentials', requirePerm('cred.all', 'cred.dept'), requireStepUpForValues, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const user = req.user!;
  const includeValues = includesValues(req);
  await assertDeviceVisible(user, id);
  const fields = await credFieldsFor(user, id);
  const scope = deviceScope(user, 'd', 3);
  const r = await q(`SELECT c.field, c.updated_at${includeValues ? ', c.enc' : ''}
    FROM device_credential c JOIN device d ON d.id=c.device_id
    WHERE d.id=$1 AND c.field=ANY($2::text[]) AND ${scope.sql}`, [id, fields, ...scope.params]);
  const by = Object.fromEntries(r.rows.map((x) => [x.field, x]));
  const out = fields.map((f) => {
    const m = CRED_FIELDS[f]!;
    return { field: f, label: m.label, sec: m.sec, kind: m.kind, requiresAccessReason: m.requiresAccessReason ?? false, set: !!by[f], updatedAt: by[f]?.updated_at ?? null, value: includeValues && !m.sec && by[f] ? decrypt(by[f].enc, `device:${id}:${f}`) : null };
  });
  const shown = out.filter((x) => x.value).map((x) => x.label);
  if (shown.length) await audit(req, { action: 'Lihat', deviceId: id, target: shown.join(', '), reason: 'Buka tab credential' });
  res.set('Cache-Control', 'no-store').json(out);
}));

const requireRevealPermission: RequestHandler = (req, res, next) => {
  const permission = req.params.field === 'passcode' ? requirePerm('cred.all', 'cred.dept') : requirePerm('cred.all');
  permission(req, res, next);
};

const requireStepUpForReveal: RequestHandler = (req, res, next) => {
  if (CRED_FIELDS[String(req.params.field)]?.requiresAccessReason) return requireStepUp(req, res, next);
  next();
};

router.post('/:id/credentials/:field/reveal', requireRevealPermission, requireStepUpForReveal, limiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = String(req.params.field);
  const user = req.user!;
  await assertDeviceVisible(user, id);
  await assertCredField(user, id, field);
  const input = req.body ?? {};
  const { mode } = z.object({ mode: z.enum(['view', 'copy']).default('view') }).parse(input);
  const meta = CRED_FIELDS[field]!;
  const reason = meta.requiresAccessReason ? await auditReason(input) : null;
  const value = await readCredential(id, field, user);
  if (!value) throw notFound('Credential belum diisi');
  await audit(req, { action: mode === 'copy' ? 'Salin' : 'Lihat', deviceId: id, target: meta.label, reason });
  res.set('Cache-Control', 'no-store').json({ value });
}));

router.put('/:id/credentials/:field', requirePerm('cred.all'), requireStepUp, limiter, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const field = String(req.params.field);
  const { value } = z.object({ value: z.string().min(1).max(200) }).parse(req.body);
  const reason = await auditReason(req.body);
  await tx(async (c) => {
    await assertDeviceVisible(req.user!, id, c, true);
    await assertCredField(req.user!, id, field, c);
    await setCredential(c, id, field, value, req.user!.id);
    await history(c, id, req.user, `Credential diubah: ${CRED_FIELDS[field]!.label}`);
    await audit(req, { action: 'Ubah', deviceId: id, target: CRED_FIELDS[field]!.label, reason }, c);
  });
  res.json({ ok: true });
}));
