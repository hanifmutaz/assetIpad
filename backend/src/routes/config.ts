// Wizard konfigurasi iPad (Super Admin & Admin iPad). Langkah menyesuaikan skenario, lokasi, dan peruntukan.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx, type Db } from '../db.js';
import { ah, bad, notFound } from '../errors.js';
import { requirePerm, requireStepUp } from '../middleware/auth.js';
import { getRules, getMaster } from '../services/rules.js';
import { audit, history } from '../services/audit.js';
import { getDeviceRow, setCredential, type DeviceRow } from '../services/devices.js';
import { allGuides, guidesFor, openRun, progress, resolveVars, varPlain, type Guide, type Run } from '../services/guides.js';
import { APPLE_ST, VAR_TOKEN_RE } from '../services/policy.js';

export const router = express.Router();
const A = requirePerm('device.config');
const uuid = z.string().uuid();
const limiter = rateLimit({ windowMs: 10 * 60e3, limit: 80, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'x', standardHeaders: 'draft-7', legacyHeaders: false });

async function ctxOf(db: Db, id: string): Promise<{ d: DeviceRow; run: Run; guides: Guide[] }> {
  const d = await getDeviceRow(id, db);
  if (d.status !== 'Setup') throw bad('iPad tidak dalam proses konfigurasi');
  let run = await openRun(db, id);
  if (!run) {
    run = (await db.query("INSERT INTO config_run(device_id,scenario) VALUES($1,'baru') RETURNING *", [id])).rows[0] as Run;
  }
  const guides = guidesFor(await allGuides(db), { scenario: run.scenario, lokasiId: d.lokasi_id, purpose: d.purpose });
  return { d, run, guides };
}

router.get('/devices/:id/config', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const R = await getRules();
  const { d, run, guides } = await tx((c) => ctxOf(c, id));
  const db = { query: q } as unknown as Db;
  const cur = await resolveVars(db, d.lokasi_id, d.purpose);
  const prev = run.from_lokasi_id ? await resolveVars(db, run.from_lokasi_id, run.from_purpose) : null;
  const fromLok = run.from_lokasi_id ? (await one<{ name: string }>('SELECT name FROM lokasi WHERE id=$1', [run.from_lokasi_id]))?.name ?? null : null;
  const used = new Set<string>();
  for (const g of guides) for (const t of [g.descr, ...g.steps.map((s) => s.text)]) for (const m of t.matchAll(VAR_TOKEN_RE)) used.add(m[2] ? `${m[1]}:lama` : m[1]!);
  const vars: Record<string, { label: string; type: string; qr: boolean; set: boolean; value: string | null; lama: boolean }> = {};
  for (const k of used) {
    const [key, lama] = k.split(':');
    const src = lama ? prev : cur;
    const v = cur[key!];
    if (!v) continue;
    const row = src?.[key!];
    vars[k] = { label: v.label + (lama ? ` (lokasi lama${fromLok ? `: ${fromLok}` : ''})` : ''), type: v.type, qr: v.qr, set: !!row?.row, value: v.type === 'text' ? varPlain(row) || null : null, lama: !!lama };
  }
  const p = progress(guides, run.state);
  res.json({
    device: { id: d.id, name: d.name, serial: d.serial, model: d.model, capacity: d.capacity, lokasi: d.lokasi, lokasi_id: d.lokasi_id, section: d.section,
      department: d.department, purpose: d.purpose, user_name: d.user_name, status: d.status, wifi: d.wifi, ios: d.ios, ip: d.ip,
      ireporter_user: d.ireporter_user, conmas_id: d.conmas_id, passcode_default: d.passcode_default },
    run: { id: run.id, scenario: run.scenario, fromLokasi: fromLok },
    guides: guides.map((g) => ({ id: g.id, title: g.title, descr: g.descr, required: g.required, steps: g.steps, fields: g.fields, auto: g.auto, state: run.state[g.id] ?? {} })),
    progress: p,
    vars,
    sys: { nama_ipad: d.name, serial: d.serial, lokasi: d.lokasi, lokasi_lama: fromLok, section: d.section, department: d.department, peruntukan: d.purpose, target_ios: R.targetIOS },
    targetIOS: R.targetIOS,
    wifiOptions: await getMaster('wifi'),
  });
}));

router.post('/devices/:id/config/step', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ guideId: uuid, stepId: z.string().max(60), state: z.enum(['done', 'skip']).nullable() }).parse(req.body);
  await tx(async (c) => {
    const { run, guides } = await ctxOf(c, id);
    const g = guides.find((x) => x.id === b.guideId);
    const s = g?.steps.find((x) => x.id === b.stepId);
    if (!g || !s) throw notFound('Langkah tidak ditemukan');
    if (b.state === 'skip' && !s.skippable) throw bad('Langkah ini wajib, tidak bisa ditandai "tidak muncul"');
    if (run.state[g.id]?.done) throw bad('Item sudah ditandai selesai');
    const st = { ...(run.state[g.id] ?? {}), steps: { ...(run.state[g.id]?.steps ?? {}) } };
    if (b.state) st.steps[b.stepId] = b.state; else delete st.steps[b.stepId];
    await c.query('UPDATE config_run SET state = state || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1', [run.id, g.id, JSON.stringify(st)]);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/complete', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ guideId: uuid, fields: z.record(z.string().max(200)).default({}) }).parse(req.body);
  const wifiOk = await getMaster('wifi');
  await tx(async (c) => {
    const { d, run, guides } = await ctxOf(c, id);
    const g = guides.find((x) => x.id === b.guideId);
    if (!g) throw notFound('Item konfigurasi tidak ditemukan');
    const st = run.state[g.id] ?? {};
    if (!g.steps.every((s) => st.steps?.[s.id])) throw bad('Centang semua langkah dulu (Selesai / Tidak muncul)');
    const sets: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const f of g.fields) {
      const v = String(b.fields[f.k] ?? '').trim();
      if (f.target === 'passcode') {
        if (!v) { if (f.required) throw bad(`${f.label} wajib diisi`); continue; }
        await setCredential(c, id, 'passcode', v, req.user!.id); // menolak 123456 / lemah / duplikat
        await audit(req, { action: 'Set passcode (konfigurasi)', deviceId: id, target: 'Passcode iPad', reason: 'Ganti passcode default' }, c);
        continue;
      }
      if (f.required && !v) throw bad(`${f.label} wajib diisi`);
      if (!v) continue;
      if (f.target === 'ios' && !/^\d+(\.\d+){0,2}$/.test(v)) throw bad('Format versi iOS mis. 18.7.9');
      if (f.target === 'ip' && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) throw bad('Format IP tidak valid');
      if (f.target === 'appleStatus' && !(APPLE_ST as readonly string[]).includes(v)) throw bad('Status Apple ID tidak valid');
      if (f.target === 'wifi' && !wifiOk.includes(v)) throw bad('SSID tidak ada di master Wi-Fi');
      if (f.target === 'note') notes[f.k] = `${f.label}: ${v}`; else sets[f.target] = v;
    }
    const vars = await resolveVars(c, d.lokasi_id, d.purpose);
    for (const [target, key] of Object.entries(g.auto ?? {})) {
      const val = varPlain(vars[key]);
      if (!val) continue;
      if (target === 'wifi') sets.wifi ??= val;
      else if (target === 'appleId' || target === 'applePwd') {
        await setCredential(c, id, target, val, req.user!.id, { enforce: false });
        await audit(req, { action: 'Set credential (konfigurasi)', deviceId: id, target: target === 'appleId' ? 'Apple ID' : 'Password Apple ID', reason: `Dari variabel ${d.lokasi} · ${d.purpose}` }, c);
      }
    }
    const COL: Record<string, string> = { ios: 'ios', wifi: 'wifi', ip: 'ip', appleStatus: 'apple_status', ireporterUser: 'ireporter_user', conmasId: 'conmas_id' };
    const cols = Object.keys(sets).filter((k) => COL[k]);
    if (cols.length || Object.keys(notes).length) {
      const extra = (sets.ios ? ', ios_updated=current_date' : '') + (sets.appleStatus ? ', apple_changed=current_date' : '');
      await c.query(`UPDATE device SET ${cols.map((k, i) => `${COL[k]}=$${i + 2}`).concat(`config_notes = config_notes || $${cols.length + 2}::jsonb`).join(', ')}${extra}, updated_at=now(), version=version+1 WHERE id=$1`,
        [id, ...cols.map((k) => sets[k]), JSON.stringify(notes)]);
    }
    const ns = { ...st, done: true, doneAt: new Date().toISOString(), doneBy: req.user!.name };
    await c.query('UPDATE config_run SET state = state || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1', [run.id, g.id, JSON.stringify(ns)]);
    await history(c, id, req.user, `Konfigurasi selesai: ${g.title}`);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/undo', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { guideId } = z.object({ guideId: uuid }).parse(req.body);
  await tx(async (c) => {
    const { run, guides } = await ctxOf(c, id);
    const g = guides.find((x) => x.id === guideId);
    if (!g) throw notFound();
    const st = { ...(run.state[g.id] ?? {}), done: false };
    await c.query('UPDATE config_run SET state = state || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1', [run.id, g.id, JSON.stringify(st)]);
    await history(c, id, req.user, `Konfigurasi dibatalkan: ${g.title}`);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/finish', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await tx(async (c) => {
    const { d, run, guides } = await ctxOf(c, id);
    const p = progress(guides, run.state);
    if (p.requiredLeft > 0) throw bad(`Masih ada ${p.requiredLeft} item wajib yang belum selesai`);
    if (d.passcode_default) throw bad('Passcode masih default (123456). Selesaikan langkah "Ganti passcode" dulu.', 'PASSCODE_DEFAULT');
    await c.query('UPDATE config_run SET finished_at=now(), finished_by=$2 WHERE id=$1', [run.id, req.user!.id]);
    await c.query("UPDATE device SET status='Available', last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1", [id]);
    await history(c, id, req.user, `Konfigurasi selesai (${run.scenario === 'baru' ? 'iPad baru' : 'reset / pindah'}) – Setup → Available`, 'Available');
  });
  await audit(req, { action: 'Konfigurasi selesai', deviceId: id });
  res.json({ ok: true });
}));

/** Nilai variabel rahasia (password Wi-Fi / Apple ID) untuk dilihat / disalin / QR. which=lama → lokasi sebelumnya (Activation Lock). */
router.post('/config-vars/:key/reveal', A, requireStepUp, limiter, ah(async (req, res) => {
  const key = z.string().regex(/^[a-z][a-z0-9_]*$/).parse(req.params.key);
  const b = z.object({ deviceId: uuid, which: z.enum(['current', 'lama']).default('current'), mode: z.enum(['view', 'copy', 'qr']).default('view') }).parse(req.body);
  const d = await getDeviceRow(b.deviceId);
  let lok: number | null = d.lokasi_id;
  let purpose: string | null = d.purpose;
  if (b.which === 'lama') {
    const run = await openRun({ query: q } as unknown as Db, d.id);
    if (!run?.from_lokasi_id) throw bad('iPad ini tidak punya lokasi sebelumnya');
    lok = run.from_lokasi_id;
    purpose = run.from_purpose;
  }
  const v = (await resolveVars({ query: q } as unknown as Db, lok, purpose))[key];
  const value = varPlain(v);
  if (!v || !value) throw notFound('Nilai belum diatur');
  await audit(req, { action: { view: 'Lihat variabel', copy: 'Salin variabel', qr: 'QR variabel' }[b.mode], deviceId: d.id, target: `${v.label}${b.which === 'lama' ? ' (lokasi lama)' : ''}`, reason: 'Konfigurasi iPad' });
  res.json({ value });
}));
