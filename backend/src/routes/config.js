// Wizard konfigurasi iPad (khusus IT Admin) + variabel konfigurasi.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { ah, bad, notFound } from '../errors.js';
import { requireRole, requireStepUp } from '../middleware/auth.js';
import { getRules, getMaster } from '../services/rules.js';
import { audit, history } from '../services/audit.js';
import { getDeviceRow, nextName, setCredential, loadVars, varPlain } from '../services/devices.js';
import { APPLE_ST, FIELD_TARGETS, VAR_TOKEN_RE } from '../services/policy.js';

export const router = express.Router();
const uuid = z.string().uuid();
const A = requireRole('admin');
const secretLimiter = rateLimit({ windowMs: 10 * 60e3, limit: 60, keyGenerator: (req) => req.user.id, standardHeaders: 'draft-7', legacyHeaders: false });

const applies = (lokIds, lokasiId) => !lokIds?.length || lokIds.includes(lokasiId);

async function deviceGuides(c, d) {
  const g = (await c.query(`SELECT g.*, COALESCE(dc.steps,'{}') steps_done, COALESCE(dc.done,false) done
     FROM guide g LEFT JOIN device_config dc ON dc.guide_id=g.id AND dc.device_id=$1 ORDER BY g.sort`, [d.id])).rows;
  return g.filter((x) => applies(x.lokasi_ids, d.lokasi_id)).map((x) => ({ ...x, steps: x.steps.filter((s) => applies(s.lokasi_ids, d.lokasi_id)) }));
}

/** Mulai konfigurasi: Pending → Setup + beri nama iPad. */
async function ensureStarted(c, d, user) {
  if (d.status !== 'Pending') return;
  const R = await getRules();
  const name = d.name || (await nextName(c, R.prefix));
  await c.query("UPDATE device SET status='Setup', name=$2, config_by=COALESCE(config_by,$3), updated_at=now(), version=version+1 WHERE id=$1", [d.id, name, user.id]);
  await history(c, d.id, user, `Konfigurasi dimulai (nama ${name})`, 'Setup');
}

router.get('/devices/:id/config', A, ah(async (req, res) => {
  const d = await getDeviceRow(uuid.parse(req.params.id));
  const R = await getRules();
  const data = await tx(async (c) => {
    const guides = await deviceGuides(c, d);
    const vars = await loadVars(c, d.lokasi_id);
    const used = new Set();
    for (const g of guides) for (const t of [g.descr, ...g.steps.map((s) => s.text)]) for (const m of String(t).matchAll(VAR_TOKEN_RE)) used.add(m[1]);
    const outVars = {};
    for (const k of used) {
      const v = vars[k];
      if (!v) continue;
      outVars[k] = { label: v.label, type: v.type, qr: v.qr, set: !!v.row, value: v.type === 'text' ? v.row?.value || '' : null };
    }
    return { guides, vars: outVars };
  });
  res.json({
    device: { id: d.id, name: d.name, serial: d.serial, model: d.model, capacity: d.capacity, lokasi: d.lokasi, lokasi_id: d.lokasi_id, section: d.section, user_name: d.user_name, status: d.status, wifi: d.wifi, ios: d.ios, apple_status: d.apple_status, ireporter_user: d.ireporter_user, conmas_id: d.conmas_id, ip: d.ip },
    guides: data.guides.map((g) => ({ id: g.id, title: g.title, descr: g.descr, required: g.required, steps: g.steps.map((s) => ({ id: s.id, text: s.text })), fields: g.fields, auto: g.auto, done: g.done, stepsDone: g.steps_done })),
    vars: data.vars,
    targetIOS: R.targetIOS,
    wifiOptions: await getMaster('wifi'),
  });
}));

router.post('/devices/:id/config/:gid/step', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const gid = uuid.parse(req.params.gid);
  const b = z.object({ stepId: z.string().max(60), done: z.boolean() }).parse(req.body);
  await tx(async (c) => {
    const d = await getDeviceRow(id, c);
    if (!['Pending', 'Setup'].includes(d.status)) throw bad('iPad tidak dalam proses konfigurasi');
    const g = (await deviceGuides(c, d)).find((x) => x.id === gid);
    if (!g || !g.steps.some((s) => s.id === b.stepId)) throw notFound('Langkah tidak ditemukan');
    if (g.done) throw bad('Item sudah ditandai selesai');
    await c.query(`INSERT INTO device_config(device_id,guide_id,steps) VALUES($1,$2,jsonb_build_object($3::text,$4::boolean))
      ON CONFLICT (device_id,guide_id) DO UPDATE SET steps = device_config.steps || jsonb_build_object($3::text,$4::boolean)`, [id, gid, b.stepId, b.done]);
    await ensureStarted(c, d, req.user);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/:gid/complete', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const gid = uuid.parse(req.params.gid);
  const b = z.object({ fields: z.record(z.string().max(200)).default({}) }).parse(req.body);
  const wifiOk = await getMaster('wifi');
  await tx(async (c) => {
    const d = await getDeviceRow(id, c);
    if (!['Pending', 'Setup'].includes(d.status)) throw bad('iPad tidak dalam proses konfigurasi');
    const g = (await deviceGuides(c, d)).find((x) => x.id === gid);
    if (!g) throw notFound('Item konfigurasi tidak ditemukan');
    if (!g.steps.every((s) => g.steps_done[s.id])) throw bad('Centang semua langkah dulu');
    const sets = {};
    const notes = {};
    for (const f of g.fields || []) {
      const v = String(b.fields[f.k] ?? '').trim();
      const t = f.target;
      if (t === 'passcode') {
        if (!v) {
          const has = await c.query("SELECT 1 FROM device_credential WHERE device_id=$1 AND field='passcode'", [id]);
          if (f.required && !has.rowCount) throw bad(`${f.label} wajib diisi`);
          continue;
        }
        await setCredential(c, id, 'passcode', v, req.user.id);
        await audit(req, { action: 'Set (konfigurasi)', deviceId: id, target: 'Passcode iPad', reason: 'Setup iPad baru' }, c);
        continue;
      }
      if (f.required && !v) throw bad(`${f.label} wajib diisi`);
      if (!v) continue;
      if (t === 'ios' && !/^\d+(\.\d+){0,2}$/.test(v)) throw bad('Format versi iOS mis. 18.7.9');
      if (t === 'ip' && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v)) throw bad('Format IP tidak valid');
      if (t === 'appleStatus' && !APPLE_ST.includes(v)) throw bad('Status Apple ID tidak valid');
      if (t === 'wifi' && !wifiOk.includes(v)) throw bad('SSID tidak ada di master Wi-Fi');
      if (t === 'note') notes[f.k] = `${f.label}: ${v}`;
      else sets[t] = v;
    }
    // nilai otomatis dari variabel per lokasi (Wi-Fi & Apple ID)
    const vars = await loadVars(c, d.lokasi_id);
    for (const [target, key] of Object.entries(g.auto || {})) {
      const val = varPlain(vars[key]);
      if (!val) continue;
      if (target === 'wifi') sets.wifi = sets.wifi || val;
      else if (target === 'appleId' || target === 'applePwd') {
        await setCredential(c, id, target, val, req.user.id, { enforce: false });
        await audit(req, { action: 'Set (konfigurasi)', deviceId: id, target: target === 'appleId' ? 'Apple ID' : 'Password Apple ID', reason: `Dari variabel lokasi ${d.lokasi}` }, c);
      }
    }
    const COL = { ios: 'ios', wifi: 'wifi', ip: 'ip', appleStatus: 'apple_status', ireporterUser: 'ireporter_user', conmasId: 'conmas_id' };
    const cols = Object.keys(sets).filter((k) => COL[k]);
    if (cols.length || Object.keys(notes).length) {
      const vals = [id, ...cols.map((k) => sets[k]), JSON.stringify(notes)];
      const extra = (sets.ios ? ', ios_updated=current_date' : '') + (sets.appleStatus ? ', apple_changed=current_date' : '');
      await c.query(`UPDATE device SET ${cols.map((k, i) => `${COL[k]}=$${i + 2}`).concat(`config_notes = config_notes || $${cols.length + 2}::jsonb`).join(', ')}${extra}, updated_at=now(), version=version+1 WHERE id=$1`, vals);
    }
    await c.query(`INSERT INTO device_config(device_id,guide_id,done,done_at,done_by) VALUES($1,$2,true,now(),$3)
      ON CONFLICT (device_id,guide_id) DO UPDATE SET done=true, done_at=now(), done_by=$3`, [id, gid, req.user.id]);
    await ensureStarted(c, d, req.user);
    await history(c, id, req.user, `Konfigurasi selesai: ${g.title}`);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/:gid/undo', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const gid = uuid.parse(req.params.gid);
  await tx(async (c) => {
    const d = await getDeviceRow(id, c);
    if (!['Pending', 'Setup'].includes(d.status)) throw bad('iPad tidak dalam proses konfigurasi');
    const r = await c.query('UPDATE device_config SET done=false, done_at=NULL, done_by=NULL WHERE device_id=$1 AND guide_id=$2 RETURNING guide_id', [id, gid]);
    if (!r.rowCount) throw notFound();
    const t = await one('SELECT title FROM guide WHERE id=$1', [gid]);
    await history(c, id, req.user, `Konfigurasi dibatalkan: ${t?.title || ''}`);
  });
  res.json({ ok: true });
}));

router.post('/devices/:id/config/finish', A, ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await tx(async (c) => {
    const d = await getDeviceRow(id, c);
    if (d.status !== 'Setup') throw bad('Konfigurasi belum dimulai');
    if (d.cfg_required_left > 0) throw bad(`Masih ada ${d.cfg_required_left} item wajib yang belum selesai`);
    await c.query("UPDATE device SET status='Available', last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1", [id]);
    await history(c, id, req.user, 'Status Setup → Available – konfigurasi selesai', 'Available');
  });
  await audit(req, { action: 'Konfigurasi selesai', deviceId: id });
  res.json({ ok: true });
}));

// ---- nilai variabel rahasia (mis. password Wi-Fi) untuk ditampilkan / QR
router.post('/config-vars/:key/reveal', A, requireStepUp, secretLimiter, ah(async (req, res) => {
  const key = z.string().regex(/^[a-z][a-z0-9_]*$/).parse(req.params.key);
  const b = z.object({ lokasiId: z.number().int().nullable().optional(), deviceId: uuid.optional(), mode: z.enum(['view', 'copy', 'qr']).default('view') }).parse(req.body);
  const vars = await tx((c) => loadVars(c, b.lokasiId ?? null));
  const v = vars[key];
  if (!v || !v.row) throw notFound('Nilai belum diatur');
  const value = varPlain(v);
  await audit(req, { action: { view: 'Lihat variabel', copy: 'Salin variabel', qr: 'QR variabel' }[b.mode], deviceId: b.deviceId || null, target: v.label, reason: 'Konfigurasi iPad' });
  res.json({ value });
}));

export const FIELD_TARGET_LIST = Object.entries(FIELD_TARGETS).map(([k, v]) => ({ target: k, ...v }));
