// Pengaturan sistem – khusus IT Admin.
import express from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { q, tx } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getRules, clearRules } from '../services/rules.js';
import { encrypt } from '../crypto.js';
import { varCtx } from '../services/devices.js';
import { FIELD_TARGETS, SYSVARS, VAR_TOKEN_RE } from '../services/policy.js';

export const router = express.Router();
router.use(requireRole('admin'));
const KINDS = ['model', 'capacity', 'wifi', 'vendor', 'problem', 'reason', 'old_model', 'reconfig'];

router.get('/', ah(async (req, res) => {
  const [lok, sec, master, rules] = await Promise.all([
    q('SELECT l.id, l.name, (SELECT count(*)::int FROM device d JOIN section s ON s.id=d.section_id WHERE s.lokasi_id=l.id) devices FROM lokasi l ORDER BY l.sort, l.name'),
    q('SELECT s.id, s.lokasi_id, s.name, (SELECT count(*)::int FROM device d WHERE d.section_id=s.id) devices FROM section s ORDER BY s.name'),
    q('SELECT id, kind, value FROM master_item ORDER BY kind, sort, value'),
    getRules(),
  ]);
  res.json({
    lokasi: lok.rows.map((l) => ({ ...l, sections: sec.rows.filter((s) => s.lokasi_id === l.id) })),
    master: Object.fromEntries(KINDS.map((k) => [k, master.rows.filter((m) => m.kind === k)])),
    rules,
  });
}));

// ---- lokasi & section
router.post('/lokasi', ah(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const r = await q('INSERT INTO lokasi(name,sort) VALUES($1,(SELECT COALESCE(max(sort),0)+1 FROM lokasi)) RETURNING id', [name]);
  await audit(req, { action: 'Tambah lokasi', target: name });
  res.status(201).json(r.rows[0]);
}));
router.delete('/lokasi/:id', ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  await tx(async (c) => {
    const used = await c.query('SELECT 1 FROM device d JOIN section s ON s.id=d.section_id WHERE s.lokasi_id=$1 LIMIT 1', [id]);
    if (used.rowCount) throw conflict('Masih ada iPad di lokasi ini – pindahkan dulu');
    const sc = await c.query('SELECT 1 FROM pic_scope ps JOIN section s ON s.id=ps.section_id WHERE s.lokasi_id=$1 LIMIT 1', [id]);
    if (sc.rowCount) throw conflict('Masih ada scope PIC di lokasi ini');
    await c.query('DELETE FROM section WHERE lokasi_id=$1', [id]);
    await c.query('DELETE FROM lokasi WHERE id=$1', [id]);
  });
  await audit(req, { action: 'Hapus lokasi', target: String(id) });
  res.json({ ok: true });
}));
router.post('/sections', ah(async (req, res) => {
  const b = z.object({ lokasiId: z.number().int(), name: z.string().trim().min(1).max(60) }).parse(req.body);
  const r = await q('INSERT INTO section(lokasi_id,name) VALUES($1,$2) RETURNING id', [b.lokasiId, b.name]);
  res.status(201).json(r.rows[0]);
}));
router.delete('/sections/:id', ah(async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const used = await q('SELECT (SELECT count(*) FROM device WHERE section_id=$1) + (SELECT count(*) FROM pic_scope WHERE section_id=$1) + (SELECT count(*) FROM transfer WHERE from_section_id=$1 OR to_section_id=$1) AS n', [id]);
  if (Number(used.rows[0].n) > 0) throw conflict('Section masih dipakai iPad / scope PIC / riwayat mutasi');
  await q('DELETE FROM section WHERE id=$1', [id]);
  res.json({ ok: true });
}));

// ---- master data
router.post('/master', ah(async (req, res) => {
  const b = z.object({ kind: z.enum(KINDS), value: z.string().trim().min(1).max(120) }).parse(req.body);
  await q('INSERT INTO master_item(kind,value,sort) VALUES($1,$2,(SELECT COALESCE(max(sort),0)+1 FROM master_item WHERE kind=$1))', [b.kind, b.value]);
  res.status(201).json({ ok: true });
}));
router.delete('/master/:id', ah(async (req, res) => {
  await q('DELETE FROM master_item WHERE id=$1', [z.coerce.number().int().parse(req.params.id)]);
  res.json({ ok: true });
}));

// ---- aturan
router.put('/rules', ah(async (req, res) => {
  const n = (min, max) => z.number().int().min(min).max(max);
  const b = z.object({
    escalateDays: n(1, 90), staleDays: n(1, 730), maxAgeYears: n(1, 20), lockMin: n(1, 60), burstCount: n(2, 100), burstMin: n(1, 120),
    targetIOS: z.string().regex(/^\d+(\.\d+){0,2}$/), prefix: z.string().regex(/^[A-Za-z][A-Za-z-]{0,15}$/),
  }).parse(req.body);
  await q(`INSERT INTO app_setting(key,value,updated_by) VALUES('rules',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now(), updated_by=$2`, [JSON.stringify(b), req.user.id]);
  clearRules();
  await audit(req, { action: 'Ubah aturan sistem' });
  res.json({ ok: true });
}));

// ---- panduan konfigurasi (no-code editor)
const stepSchema = z.object({ id: z.string().max(60).optional(), text: z.string().trim().min(1).max(2000), lokasi_ids: z.array(z.number().int()).max(50).default([]) });
const fieldSchema = z.object({
  k: z.string().regex(/^[A-Za-z][\w]{0,40}$/), label: z.string().trim().min(1).max(80),
  target: z.enum(Object.keys(FIELD_TARGETS)), required: z.boolean().default(false),
});
const guideSchema = z.object({
  title: z.string().trim().min(1).max(160), descr: z.string().max(2000).default(''), required: z.boolean().default(true),
  lokasi_ids: z.array(z.number().int()).max(50).default([]),
  steps: z.array(stepSchema).min(1).max(60), fields: z.array(fieldSchema).max(10).default([]),
  auto: z.record(z.enum(['wifi', 'appleId', 'applePwd']), z.string()).default({}),
});

async function validateGuide(g) {
  const keys = new Set((await q('SELECT key FROM config_var')).rows.map((r) => r.key));
  const unknown = new Set();
  for (const t of [g.descr, ...g.steps.map((s) => s.text)]) for (const m of t.matchAll(VAR_TOKEN_RE)) if (!keys.has(m[1]) && !SYSVARS[m[1]]) unknown.add(m[1]);
  if (unknown.size) throw bad(`Variabel tidak dikenal: ${[...unknown].join(', ')} – tambahkan di tab Variabel dulu`);
  const targets = g.fields.map((f) => (f.target === 'note' ? f.k : f.target));
  if (new Set(targets).size !== targets.length) throw bad('Ada isian yang disimpan ke data yang sama');
  for (const k of Object.values(g.auto)) if (!keys.has(k)) throw bad(`Variabel otomatis ${k} tidak ada`);
  g.steps = g.steps.map((s) => ({ ...s, id: s.id && /^[\w-]{1,60}$/.test(s.id) ? s.id : crypto.randomUUID() }));
  g.fields = g.fields.map((f) => (f.target === 'note' ? f : { ...f, k: f.target }));
  return g;
}

router.get('/guides', ah(async (req, res) => {
  const [g, v] = await Promise.all([q('SELECT * FROM guide ORDER BY sort'), q('SELECT key,label,type FROM config_var ORDER BY sort,key')]);
  res.json({ guides: g.rows, vars: v.rows, sysvars: SYSVARS, targets: FIELD_TARGETS });
}));
router.post('/guides', ah(async (req, res) => {
  const g = await validateGuide(guideSchema.parse(req.body));
  const r = await q(`INSERT INTO guide(sort,title,descr,required,lokasi_ids,steps,fields,auto,updated_by)
    VALUES((SELECT COALESCE(max(sort),0)+1 FROM guide),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
  [g.title, g.descr, g.required, g.lokasi_ids, JSON.stringify(g.steps), JSON.stringify(g.fields), JSON.stringify(g.auto), req.user.id]);
  await audit(req, { action: 'Tambah panduan', target: g.title });
  res.status(201).json(r.rows[0]);
}));
router.put('/guides/:id', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const g = await validateGuide(guideSchema.parse(req.body));
  const r = await q(`UPDATE guide SET title=$2, descr=$3, required=$4, lokasi_ids=$5, steps=$6, fields=$7, auto=$8, updated_at=now(), updated_by=$9 WHERE id=$1`,
    [id, g.title, g.descr, g.required, g.lokasi_ids, JSON.stringify(g.steps), JSON.stringify(g.fields), JSON.stringify(g.auto), req.user.id]);
  if (!r.rowCount) throw notFound();
  await audit(req, { action: 'Ubah panduan', target: g.title });
  res.json({ ok: true });
}));
router.delete('/guides/:id', ah(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const r = await q('DELETE FROM guide WHERE id=$1 RETURNING title', [id]);
  if (!r.rowCount) throw notFound();
  await audit(req, { action: 'Hapus panduan', target: r.rows[0].title });
  res.json({ ok: true });
}));
router.post('/guides/reorder', ah(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(req.body);
  await tx(async (c) => { for (const [i, id] of ids.entries()) await c.query('UPDATE guide SET sort=$2 WHERE id=$1', [id, i]); });
  res.json({ ok: true });
}));

// ---- variabel konfigurasi (nilai rahasia tidak pernah dikirim ke browser di sini)
router.get('/vars', ah(async (req, res) => {
  const [v, vals, g] = await Promise.all([
    q('SELECT key,label,type,qr,sort FROM config_var ORDER BY sort,key'),
    q('SELECT key, lokasi_id, value, enc IS NOT NULL AS has_secret FROM config_var_value'),
    q('SELECT descr, steps FROM guide'),
  ]);
  const texts = g.rows.flatMap((x) => [x.descr, ...x.steps.map((s) => s.text)]);
  res.json(v.rows.map((x) => ({
    ...x,
    used: texts.filter((t) => t.includes(`{{${x.key}}}`)).length,
    values: Object.fromEntries(vals.rows.filter((r) => r.key === x.key).map((r) => [r.lokasi_id ?? 'default', x.type === 'secret' ? { set: r.has_secret } : { value: r.value }])),
  })));
}));
router.post('/vars', ah(async (req, res) => {
  const b = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: z.string().trim().min(1).max(80), type: z.enum(['text', 'secret']) }).parse(req.body);
  if (SYSVARS[b.key]) throw bad('Kode dipakai variabel sistem');
  await q('INSERT INTO config_var(key,label,type,qr,sort) VALUES($1,$2,$3,$4,(SELECT COALESCE(max(sort),0)+1 FROM config_var))', [b.key, b.label, b.type, b.type === 'text']);
  await audit(req, { action: 'Tambah variabel', target: b.key });
  res.status(201).json({ ok: true });
}));
router.delete('/vars/:key', ah(async (req, res) => {
  await q('DELETE FROM config_var WHERE key=$1', [req.params.key]);
  await audit(req, { action: 'Hapus variabel', target: req.params.key });
  res.json({ ok: true });
}));
/**
 * Simpan nilai: { label, qr, values: { default: "x" | null, "<lokasiId>": "y" | null } }
 * Untuk secret: undefined = tidak diubah, "" atau null = hapus, string = ganti.
 */
router.put('/vars/:key', ah(async (req, res) => {
  const key = req.params.key;
  const b = z.object({ label: z.string().trim().min(1).max(80), qr: z.boolean(), values: z.record(z.string().nullable()).default({}) }).parse(req.body);
  await tx(async (c) => {
    const v = (await c.query('SELECT type FROM config_var WHERE key=$1', [key])).rows[0];
    if (!v) throw notFound();
    await c.query('UPDATE config_var SET label=$2, qr=$3 WHERE key=$1', [key, b.label, b.qr]);
    for (const [slot, raw] of Object.entries(b.values)) {
      const lokasiId = slot === 'default' ? null : Number(slot);
      if (slot !== 'default' && !Number.isInteger(lokasiId)) throw bad('Lokasi tidak valid');
      const val = raw == null ? '' : String(raw).trim();
      if (val.length > 300) throw bad('Nilai terlalu panjang');
      await c.query(`DELETE FROM config_var_value WHERE key=$1 AND lokasi_id ${lokasiId === null ? 'IS NULL' : '= $2'}`, lokasiId === null ? [key] : [key, lokasiId]);
      if (!val) continue;
      if (v.type === 'secret') await c.query('INSERT INTO config_var_value(key,lokasi_id,enc) VALUES($1,$2,$3)', [key, lokasiId, encrypt(val, varCtx(key, lokasiId))]);
      else await c.query('INSERT INTO config_var_value(key,lokasi_id,value) VALUES($1,$2,$3)', [key, lokasiId, val]);
    }
  });
  await audit(req, { action: 'Ubah variabel konfigurasi', target: key });
  res.json({ ok: true });
}));
