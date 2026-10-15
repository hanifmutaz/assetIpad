import { one, q } from '../db.js';
import { encrypt, decrypt, hmac } from '../crypto.js';
import { bad, notFound } from '../errors.js';
import { scopeSql } from './access.js';
import { CRED_FIELDS, weakReason, ACTIVE } from './policy.js';
import { getMaster } from './rules.js';

export const DEV_FROM = `FROM device d
  JOIN section s ON s.id = d.section_id
  JOIN lokasi l ON l.id = s.lokasi_id
  LEFT JOIN v_device_pic vp ON vp.device_id = d.id
  LEFT JOIN v_device_cfg vc ON vc.device_id = d.id`;

export const DEV_COLS = `d.id, d.serial, d.name, d.model, d.capacity, d.color, d.user_name, d.status, d.arrival, d.vendor, d.price,
  d.wifi, host(d.ip) AS ip, d.conmas_id, d.ireporter_user, d.ios, d.ios_updated, d.last_check, d.apple_status, d.apple_changed,
  d.passcode_changed, d.reconfig, d.config_notes, d.retire, d.photo_id, d.note, d.version, d.created_at,
  l.id AS lokasi_id, l.name AS lokasi, s.id AS section_id, s.name AS section,
  COALESCE(vp.pic_names, '') AS pic_names, COALESCE(vp.pic_ids, '{}') AS pic_ids,
  COALESCE(vc.total, 0) AS cfg_total, COALESCE(vc.done, 0) AS cfg_done, COALESCE(vc.required_left, 0) AS cfg_required_left`;

const TECH = ['wifi', 'ip', 'conmas_id', 'ireporter_user', 'ios', 'ios_updated', 'apple_status', 'apple_changed', 'passcode_changed', 'reconfig', 'config_notes', 'vendor'];

/** Batasi field sesuai role (User tidak lihat data teknis, harga hanya Admin/Manager). */
export function shapeDevice(d, user) {
  const o = { ...d };
  if (!['Pending', 'Setup'].includes(o.status)) o.cfg_done = o.cfg_total;
  o.in_scope = user.role === 'pic' && (o.pic_ids || []).includes(user.id);
  if (user.role === 'user') for (const k of TECH) delete o[k];
  if (!['admin', 'manager'].includes(user.role)) delete o.price;
  delete o.pic_ids;
  return o;
}

const SORT = {
  name: ["(substring(d.name from '(\\d+)'))::int", 'd.name'],
  serial: ['d.serial'], loc: ['l.name', 's.name'], model: ['d.model'], pic: ['d.user_name'], picUser: ['vp.pic_names'],
  ireporterUser: ['d.ireporter_user'], ios: ['d.ios'], setup: ['vc.done'], lastCheck: ['d.last_check'], price: ['d.price'],
  arrival: ['d.arrival'],
  status: ["array_position(ARRAY['Pending','Setup','Available','Repair','Damaged','Loss','Retired'], d.status)"],
};

/** Bangun WHERE + ORDER dari filter (semua nilai lewat parameter → aman dari SQL injection). */
export async function deviceFilterSql(user, f, R) {
  const p = [];
  const P = (v) => { p.push(v); return `$${p.length}`; };
  const w = [];
  if (f.q) {
    const x = P(`%${f.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    w.push(`(d.name ILIKE ${x} OR d.serial ILIKE ${x} OR s.name ILIKE ${x} OR d.user_name ILIKE ${x} OR d.model ILIKE ${x} OR d.ireporter_user ILIKE ${x} OR vp.pic_names ILIKE ${x})`);
  }
  if (f.lokasiId) w.push(`l.id = ${P(f.lokasiId)}`);
  if (f.sectionId) w.push(`s.id = ${P(f.sectionId)}`);
  if (f.status) w.push(`d.status = ANY(${P(f.status === 'Pending' ? ['Pending', 'Setup'] : f.status.split(','))})`);
  if (f.mine && user.role === 'pic') w.push(scopeSql('d', P(user.id)));
  const inUse = "d.status IN ('Available','Repair')";
  switch (f.flag) {
    case 'stale': w.push(`${inUse} AND (d.last_check IS NULL OR d.last_check < current_date - ${P(R.staleDays)}::int)`); break;
    case 'weak': if (user.role === 'admin') w.push(`d.status = ANY(${P(ACTIVE)}) AND EXISTS (SELECT 1 FROM device_credential c WHERE c.device_id=d.id AND c.field='passcode' AND c.weak)`); break;
    case 'apple': w.push(`${inUse} AND d.apple_status <> 'Done'`); break;
    case 'old': w.push(`${inUse} AND (d.model = ANY(${P(await getMaster('old_model'))}) OR d.arrival < current_date - make_interval(years => ${P(R.maxAgeYears)}))`); break;
    case 'nopic': w.push(`d.status = ANY(${P(ACTIVE)}) AND vp.device_id IS NULL`); break;
    default: break;
  }
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const order = (SORT[f.sort] || SORT.name).map((e) => `${e} ${dir} NULLS LAST`).concat('d.serial').join(', ');
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', order, params: p, P };
}

export async function getDeviceRow(id, client) {
  const db = client || { query: q };
  const r = await db.query(`SELECT ${DEV_COLS} ${DEV_FROM} WHERE d.id = $1`, [id]);
  if (!r.rows[0]) throw notFound('iPad tidak ditemukan');
  return r.rows[0];
}

/** Nama iPad berikutnya (iPad128 dst). Dikunci advisory lock agar tidak bentrok. */
export async function nextName(client, prefix) {
  await client.query('SELECT pg_advisory_xact_lock(727002)');
  const r = await client.query("SELECT COALESCE(max((substring(name from '(\\d+)$'))::int), 0) AS n FROM device WHERE name ~ '\\d+$'");
  return `${prefix}${r.rows[0].n + 1}`;
}

/** Simpan credential terenkripsi + validasi kekuatan & duplikat. */
export async function setCredential(client, deviceId, field, value, userId, { enforce = true } = {}) {
  const meta = CRED_FIELDS[field];
  if (!meta) throw bad('Field credential tidak dikenal');
  const v = String(value ?? '').trim();
  if (!v || v.length > 200) throw bad(`${meta.label} tidak valid`);
  const weak = weakReason(v, meta.kind);
  if (enforce && weak) throw bad(`${meta.label} ditolak – ${weak}`, 'WEAK');
  const h = hmac(v, field);
  if (enforce && meta.unique) {
    const dup = await client.query('SELECT 1 FROM device_credential WHERE field=$1 AND hmac=$2 AND device_id<>$3 LIMIT 1', [field, h, deviceId]);
    if (dup.rowCount) throw bad(`${meta.label} sudah dipakai iPad lain – gunakan nilai unik`, 'DUPLICATE_SECRET');
  }
  const cur = await client.query('SELECT hmac FROM device_credential WHERE device_id=$1 AND field=$2', [deviceId, field]);
  if (enforce && meta.sec && cur.rows[0]?.hmac === h) throw bad(`${meta.label} sama dengan nilai lama`);
  await client.query(
    `INSERT INTO device_credential(device_id,field,enc,hmac,weak,updated_by) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (device_id, field) DO UPDATE SET enc=EXCLUDED.enc, hmac=EXCLUDED.hmac, weak=EXCLUDED.weak, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [deviceId, field, encrypt(v, `device:${deviceId}:${field}`), h, !!weak, userId],
  );
  if (field === 'passcode') await client.query('UPDATE device SET passcode_changed=current_date WHERE id=$1', [deviceId]);
  if (field === 'appleId' || field === 'applePwd') await client.query('UPDATE device SET apple_changed=current_date WHERE id=$1', [deviceId]);
}

export async function readCredential(deviceId, field) {
  const r = await one('SELECT enc FROM device_credential WHERE device_id=$1 AND field=$2', [deviceId, field]);
  return r ? decrypt(r.enc, `device:${deviceId}:${field}`) : '';
}

/** Nilai variabel konfigurasi untuk lokasi tertentu (lokasi > default). */
export async function loadVars(client, lokasiId) {
  const vars = (await client.query('SELECT key,label,type,qr,sort FROM config_var ORDER BY sort,key')).rows;
  const vals = (await client.query('SELECT key,lokasi_id,value,enc FROM config_var_value WHERE lokasi_id=$1 OR lokasi_id IS NULL', [lokasiId])).rows;
  const out = {};
  for (const v of vars) {
    const own = vals.find((x) => x.key === v.key && x.lokasi_id === lokasiId) || vals.find((x) => x.key === v.key && x.lokasi_id === null);
    out[v.key] = { ...v, row: own || null };
  }
  return out;
}
export const varCtx = (key, lokasiId) => `var:${key}:${lokasiId ?? 'default'}`;
export function varPlain(v) {
  if (!v?.row) return '';
  return v.type === 'secret' ? decrypt(v.row.enc, varCtx(v.key, v.row.lokasi_id)) : v.row.value || '';
}
