import express from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { q, tx } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getRules, clearRules } from '../services/rules.js';
import { encrypt } from '../crypto.js';
import { varCtx } from '../services/guides.js';
import { FIELD_TARGETS, SYSVARS, VAR_TOKEN_RE, SCENARIOS } from '../services/policy.js';

export const router = express.Router();
const SA = requirePerm('settings.master');
const KINDS = ['model', 'capacity', 'wifi', 'vendor', 'purpose', 'problem', 'reason', 'old_model', 'reconfig'] as const;
const id = z.coerce.number().int();
const name = z.object({ name: z.string().trim().min(1).max(60) });

router.get('/', SA, ah(async (_req, res) => {
  const [lok, sec, dept, master, rules] = await Promise.all([
    q('SELECT l.id, l.name, (SELECT count(*)::int FROM device d JOIN section s ON s.id=d.section_id WHERE s.lokasi_id=l.id) devices FROM lokasi l ORDER BY l.sort, l.name'),
    q('SELECT s.id, s.lokasi_id, s.name, (SELECT count(*)::int FROM device d WHERE d.section_id=s.id) devices FROM section s ORDER BY s.name'),
    q('SELECT dp.id, dp.name, (SELECT count(*)::int FROM device d WHERE d.department_id=dp.id) devices FROM department dp ORDER BY dp.name'),
    q('SELECT id, kind, value FROM master_item ORDER BY kind, sort, value'),
    getRules(),
  ]);
  res.json({
    lokasi: lok.rows.map((l) => ({ ...l, sections: sec.rows.filter((s) => s.lokasi_id === l.id) })),
    departments: dept.rows,
    master: Object.fromEntries(KINDS.map((k) => [k, master.rows.filter((m) => m.kind === k)])),
    rules,
  });
}));

// ---- lokasi, section, department
router.post('/lokasi', SA, ah(async (req, res) => {
  const b = name.parse(req.body);
  await q('INSERT INTO lokasi(name,sort) VALUES($1,(SELECT COALESCE(max(sort),0)+1 FROM lokasi))', [b.name]);
  await audit(req, { action: 'Tambah lokasi', target: b.name });
  res.status(201).json({ ok: true });
}));
router.delete('/lokasi/:id', SA, ah(async (req, res) => {
  const lid = id.parse(req.params.id);
  await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM device d JOIN section s ON s.id=d.section_id WHERE s.lokasi_id=$1 LIMIT 1', [lid])).rowCount) throw conflict('Masih ada iPad di lokasi ini – pindahkan dulu');
    await c.query('DELETE FROM section WHERE lokasi_id=$1', [lid]);
    await c.query('DELETE FROM lokasi WHERE id=$1', [lid]);
  });
  await audit(req, { action: 'Hapus lokasi', target: String(lid) });
  res.json({ ok: true });
}));
router.post('/sections', SA, ah(async (req, res) => {
  const b = z.object({ lokasiId: z.number().int(), name: z.string().trim().min(1).max(60) }).parse(req.body);
  await q('INSERT INTO section(lokasi_id,name) VALUES($1,$2)', [b.lokasiId, b.name]);
  res.status(201).json({ ok: true });
}));
router.delete('/sections/:id', SA, ah(async (req, res) => {
  const sid = id.parse(req.params.id);
  const n = (await q('SELECT (SELECT count(*) FROM device WHERE section_id=$1) + (SELECT count(*) FROM transfer WHERE from_section_id=$1 OR to_section_id=$1) AS n', [sid])).rows[0]?.n;
  if (Number(n) > 0) throw conflict('Section masih dipakai iPad / riwayat mutasi');
  await q('DELETE FROM section WHERE id=$1', [sid]);
  res.json({ ok: true });
}));
router.post('/departments', SA, ah(async (req, res) => {
  const b = name.parse(req.body);
  await q('INSERT INTO department(name) VALUES($1)', [b.name]);
  await audit(req, { action: 'Tambah department', target: b.name });
  res.status(201).json({ ok: true });
}));
router.patch('/departments/:id', SA, ah(async (req, res) => {
  const b = name.parse(req.body);
  await q('UPDATE department SET name=$2 WHERE id=$1', [id.parse(req.params.id), b.name]);
  res.json({ ok: true });
}));
router.delete('/departments/:id', SA, ah(async (req, res) => {
  const did = id.parse(req.params.id);
  const n = (await q('SELECT (SELECT count(*) FROM device WHERE department_id=$1) + (SELECT count(*) FROM transfer WHERE from_department_id=$1 OR to_department_id=$1) AS n', [did])).rows[0]?.n;
  if (Number(n) > 0) throw conflict('Department masih dipakai iPad / riwayat mutasi');
  await q('DELETE FROM user_department WHERE department_id=$1', [did]);
  await q('DELETE FROM department WHERE id=$1', [did]);
  await audit(req, { action: 'Hapus department', target: String(did) });
  res.json({ ok: true });
}));

// ---- master data (hapus dicek pemakaian)
router.post('/master', SA, ah(async (req, res) => {
  const b = z.object({ kind: z.enum(KINDS), value: z.string().trim().min(1).max(120) }).parse(req.body);
  await q('INSERT INTO master_item(kind,value,sort) VALUES($1,$2,(SELECT COALESCE(max(sort),0)+1 FROM master_item WHERE kind=$1))', [b.kind, b.value]);
  res.status(201).json({ ok: true });
}));
router.delete('/master/:id', SA, ah(async (req, res) => {
  const m = (await q('SELECT kind, value FROM master_item WHERE id=$1', [id.parse(req.params.id)])).rows[0];
  if (!m) throw notFound();
  const col: Record<string, string> = { model: 'model', capacity: 'capacity', wifi: 'wifi', vendor: 'vendor', purpose: 'purpose' };
  if (col[m.kind] && (await q(`SELECT 1 FROM device WHERE ${col[m.kind]}=$1 LIMIT 1`, [m.value])).rowCount) throw conflict(`"${m.value}" masih dipakai iPad`);
  await q('DELETE FROM master_item WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

router.put('/rules', SA, ah(async (req, res) => {
  const n = (a: number, b: number) => z.number().int().min(a).max(b);
  const b = z.object({ escalateDays: n(1, 90), staleDays: n(1, 730), maxAgeYears: n(1, 20), lockMin: n(1, 60), burstCount: n(2, 100), burstMin: n(1, 120),
    targetIOS: z.string().regex(/^\d+(\.\d+){0,2}$/), prefix: z.string().regex(/^[A-Za-z][A-Za-z-]{0,15}$/) }).parse(req.body);
  await q("INSERT INTO app_setting(key,value,updated_by) VALUES('rules',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now(), updated_by=$2", [JSON.stringify(b), req.user!.id]);
  clearRules();
  await audit(req, { action: 'Ubah aturan sistem' });
  res.json({ ok: true });
}));

// ---- panduan konfigurasi (Super Admin & Admin iPad)
const G = requirePerm('guide.edit');
const cond = z.object({ scenarios: z.array(z.enum(['baru', 'reset'])).default([]), lokasi_ids: z.array(z.number().int()).default([]), purposes: z.array(z.string().max(60)).default([]) }).default({});
const guideSchema = z.object({
  title: z.string().trim().min(1).max(160), descr: z.string().max(2000).default(''), required: z.boolean().default(true), cond,
  steps: z.array(z.object({ id: z.string().max(60).optional(), text: z.string().trim().min(1).max(2000), cond, skippable: z.boolean().default(false) })).min(1).max(80),
  fields: z.array(z.object({ k: z.string().regex(/^[A-Za-z]\w{0,40}$/), label: z.string().trim().min(1).max(80),
    target: z.enum(Object.keys(FIELD_TARGETS) as [string, ...string[]]), required: z.boolean().default(false) })).max(10).default([]),
  auto: z.record(z.enum(['wifi', 'appleId', 'applePwd']), z.string()).default({}),
});
async function validateGuide(g: z.infer<typeof guideSchema>) {
  const keys = new Set((await q('SELECT key FROM config_var')).rows.map((r) => r.key as string));
  const unknown = new Set<string>();
  for (const t of [g.descr, ...g.steps.map((s) => s.text)]) for (const m of t.matchAll(VAR_TOKEN_RE)) if (!keys.has(m[1]!) && !SYSVARS[m[1]!]) unknown.add(m[1]!);
  if (unknown.size) throw bad(`Variabel tidak dikenal: ${[...unknown].join(', ')} – tambahkan di tab Variabel dulu`);
  const targets = g.fields.map((f) => (f.target === 'note' ? f.k : f.target));
  if (new Set(targets).size !== targets.length) throw bad('Ada isian yang disimpan ke data yang sama');
  for (const k of Object.values(g.auto)) if (!keys.has(k)) throw bad(`Variabel otomatis ${k} tidak ada`);
  return { ...g, steps: g.steps.map((s) => ({ ...s, id: s.id && /^[\w-]{1,60}$/.test(s.id) ? s.id : crypto.randomUUID() })), fields: g.fields.map((f) => (f.target === 'note' ? f : { ...f, k: f.target })) };
}
router.get('/guides', G, ah(async (_req, res) => {
  const [g, v] = await Promise.all([q('SELECT * FROM guide ORDER BY sort'), q('SELECT key,label,type FROM config_var ORDER BY sort,key')]);
  res.json({ guides: g.rows, vars: v.rows, sysvars: SYSVARS, targets: FIELD_TARGETS, scenarios: SCENARIOS });
}));
router.post('/guides', G, ah(async (req, res) => {
  const g = await validateGuide(guideSchema.parse(req.body));
  const r = await q(`INSERT INTO guide(sort,title,descr,required,cond,steps,fields,auto,updated_by) VALUES((SELECT COALESCE(max(sort),0)+1 FROM guide),$1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [g.title, g.descr, g.required, JSON.stringify(g.cond), JSON.stringify(g.steps), JSON.stringify(g.fields), JSON.stringify(g.auto), req.user!.id]);
  await audit(req, { action: 'Tambah panduan', target: g.title });
  res.status(201).json(r.rows[0]);
}));
router.put('/guides/:id', G, ah(async (req, res) => {
  const gid = z.string().uuid().parse(req.params.id);
  const g = await validateGuide(guideSchema.parse(req.body));
  const r = await q('UPDATE guide SET title=$2, descr=$3, required=$4, cond=$5, steps=$6, fields=$7, auto=$8, updated_at=now(), updated_by=$9 WHERE id=$1',
    [gid, g.title, g.descr, g.required, JSON.stringify(g.cond), JSON.stringify(g.steps), JSON.stringify(g.fields), JSON.stringify(g.auto), req.user!.id]);
  if (!r.rowCount) throw notFound();
  await audit(req, { action: 'Ubah panduan', target: g.title });
  res.json({ ok: true });
}));
router.delete('/guides/:id', G, ah(async (req, res) => {
  const r = await q('DELETE FROM guide WHERE id=$1 RETURNING title', [z.string().uuid().parse(req.params.id)]);
  if (!r.rowCount) throw notFound();
  await audit(req, { action: 'Hapus panduan', target: r.rows[0].title });
  res.json({ ok: true });
}));
router.post('/guides/reorder', G, ah(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200) }).parse(req.body);
  await tx(async (c) => { for (const [i, gid] of ids.entries()) await c.query('UPDATE guide SET sort=$2 WHERE id=$1', [gid, i]); });
  res.json({ ok: true });
}));

// ---- variabel konfigurasi (Super Admin). Nilai rahasia tidak pernah dikirim balik ke browser di sini.
const V = requirePerm('var.edit');
router.get('/vars', V, ah(async (_req, res) => {
  const [v, vals, g] = await Promise.all([
    q('SELECT key,label,type,qr,sort FROM config_var ORDER BY sort,key'),
    q('SELECT id, key, lokasi_id, purpose, value, enc IS NOT NULL AS has_secret FROM config_var_value ORDER BY lokasi_id NULLS FIRST, purpose NULLS FIRST'),
    q('SELECT descr, steps FROM guide'),
  ]);
  const texts: string[] = g.rows.flatMap((x) => [x.descr, ...x.steps.map((s: { text: string }) => s.text)]);
  res.json(v.rows.map((x) => ({
    ...x,
    used: texts.filter((t) => t.includes(`{{${x.key}}}`) || t.includes(`{{${x.key}:lama}}`)).length,
    values: vals.rows.filter((r) => r.key === x.key).map((r) => ({ id: r.id, lokasi_id: r.lokasi_id, purpose: r.purpose, value: x.type === 'secret' ? null : r.value, set: x.type === 'secret' ? r.has_secret : !!r.value })),
  })));
}));
router.post('/vars', V, ah(async (req, res) => {
  const b = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), label: z.string().trim().min(1).max(80), type: z.enum(['text', 'secret']) }).parse(req.body);
  if (SYSVARS[b.key]) throw bad('Kode dipakai variabel sistem');
  await q('INSERT INTO config_var(key,label,type,qr,sort) VALUES($1,$2,$3,$4,(SELECT COALESCE(max(sort),0)+1 FROM config_var))', [b.key, b.label, b.type, b.type === 'text']);
  await audit(req, { action: 'Tambah variabel', target: b.key });
  res.status(201).json({ ok: true });
}));
router.put('/vars/:key', V, ah(async (req, res) => {
  const b = z.object({ label: z.string().trim().min(1).max(80), qr: z.boolean() }).parse(req.body);
  await q('UPDATE config_var SET label=$2, qr=$3 WHERE key=$1', [req.params.key, b.label, b.qr]);
  res.json({ ok: true });
}));
router.delete('/vars/:key', V, ah(async (req, res) => {
  await q('DELETE FROM config_var WHERE key=$1', [req.params.key]);
  await audit(req, { action: 'Hapus variabel', target: String(req.params.key) });
  res.json({ ok: true });
}));
/** Simpan nilai untuk kombinasi (lokasi?, peruntukan?). Kosong pada lokasi/peruntukan = berlaku umum. */
router.post('/vars/:key/values', V, ah(async (req, res) => {
  const key = String(req.params.key);
  const b = z.object({ lokasiId: z.number().int().nullable(), purpose: z.string().max(60).nullable(), value: z.string().trim().min(1).max(300) }).parse(req.body);
  await tx(async (c) => {
    const v = (await c.query('SELECT type FROM config_var WHERE key=$1', [key])).rows[0];
    if (!v) throw notFound();
    const ex = (await c.query('SELECT id FROM config_var_value WHERE key=$1 AND lokasi_id IS NOT DISTINCT FROM $2 AND purpose IS NOT DISTINCT FROM $3', [key, b.lokasiId, b.purpose])).rows[0];
    const rowId: number = ex?.id ?? (await c.query("INSERT INTO config_var_value(key,lokasi_id,purpose,value) VALUES($1,$2,$3,'') RETURNING id", [key, b.lokasiId, b.purpose])).rows[0].id;
    if (v.type === 'secret') await c.query('UPDATE config_var_value SET value=NULL, enc=$2 WHERE id=$1', [rowId, encrypt(b.value, varCtx({ key, id: rowId }))]);
    else await c.query('UPDATE config_var_value SET value=$2, enc=NULL WHERE id=$1', [rowId, b.value]);
  });
  await audit(req, { action: 'Ubah nilai variabel', target: `${key} [lokasi ${b.lokasiId ?? 'semua'} · ${b.purpose ?? 'semua'}]` });
  res.json({ ok: true });
}));
router.delete('/vars/:key/values/:id', V, ah(async (req, res) => {
  await q('DELETE FROM config_var_value WHERE id=$1 AND key=$2', [id.parse(req.params.id), req.params.key]);
  await audit(req, { action: 'Hapus nilai variabel', target: String(req.params.key) });
  res.json({ ok: true });
}));
