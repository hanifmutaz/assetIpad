import { q, one, type Db } from '../db.js';
import { encrypt, decrypt, hmac } from '../crypto.js';
import { bad, notFound } from '../errors.js';
import type { AuthUser } from '../types.js';
import { deviceScope } from './access.js';
import { can, CRED_FIELDS, weakReason } from './policy.js';

export const DEV_FROM = `FROM device d
  JOIN section s ON s.id = d.section_id
  JOIN lokasi l ON l.id = s.lokasi_id
  JOIN department dp ON dp.id = d.department_id`;
export const DEV_COLS = `d.id, d.serial, d.name, d.ina_no, d.model, d.capacity, d.color, d.user_name, d.status, d.purpose, d.arrival, d.vendor, d.price,
  d.wifi, host(d.ip) AS ip, d.conmas_id, d.ireporter_user, d.ios, d.ios_updated, d.last_check, d.apple_status, d.apple_changed,
  d.passcode_changed, d.passcode_default, d.reconfig, d.config_notes, d.retire, d.photo_id, d.note, d.version, d.created_at,
  d.charger_included, d.cable_included, d.box_included, d.has_warranty, d.warranty_until,
  l.id AS lokasi_id, l.name AS lokasi, s.id AS section_id, s.name AS section, dp.id AS department_id, dp.name AS department`;

export interface DeviceRow {
  id: string; serial: string; name: string | null; ina_no: string | null; model: string; capacity: string | null; color: string | null; user_name: string;
  status: string; purpose: string; arrival: string | null; vendor: string | null; price: number | null; wifi: string | null; ip: string | null;
  conmas_id: string | null; ireporter_user: string | null; ios: string | null; ios_updated: string | null; last_check: string | null;
  apple_status: string; apple_changed: string | null; passcode_changed: string | null; passcode_default: boolean;
  charger_included: boolean | null; cable_included: boolean | null; box_included: boolean | null;
  has_warranty: boolean | null; warranty_until: string | null;
  reconfig: { done: boolean[]; plan?: string | null; actual?: string | null }; config_notes: Record<string, string>;
  retire: Record<string, string> | null; photo_id: string | null; note: string | null; version: number; created_at: string;
  lokasi_id: number; lokasi: string; section_id: number; section: string; department_id: number; department: string;
  [k: string]: unknown;
}

/** Batasi kolom sesuai role: harga & vendor hanya Super Admin & Admin iPad. */
export function shapeDevice(d: DeviceRow, u: AuthUser): Record<string, unknown> {
  const o: Record<string, unknown> = { ...d };
  if (!can(u, 'device.viewAll')) { delete o.price; delete o.vendor; }
  return o;
}

export async function getDeviceRow(id: string, db: Db = { query: q } as unknown as Db): Promise<DeviceRow> {
  const r = await db.query(`SELECT ${DEV_COLS} ${DEV_FROM} WHERE d.id=$1`, [id]);
  const row = r.rows[0] as DeviceRow | undefined;
  if (!row) throw notFound('iPad tidak ditemukan');
  return row;
}

export const GENERATED_NAME = /^[A-Z0-9]+-IPAD-\d{2}-\d+$/i;
export const lockDeviceNames = (db: Db) => db.query('SELECT pg_advisory_xact_lock(727002)');

export function deviceNamePrefix(location: string, id: number): string {
  const key = location.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (['HIROSE', 'HRS', 'PTHIROSEELECTRICINDONESIA'].includes(key)) return 'HRS';
  if (key === 'SGP') return 'SGP';
  if (key === 'SYSTECH') return 'Systech';
  return key.slice(0, 16) || 'LOC' + id;
}

export async function nextName(db: Db, sectionId: number, arrival: string): Promise<string> {
  const site = (await db.query<{ id: number; name: string; ipad_number_start: number }>(
    'SELECT l.id, l.name, l.ipad_number_start FROM lokasi l JOIN section s ON s.lokasi_id=l.id WHERE s.id=$1 FOR SHARE OF l,s',
    [sectionId])).rows[0];
  if (!site) throw bad('Section tidak valid');
  const stem = deviceNamePrefix(site.name, site.id) + '-IPAD-' + arrival.slice(2, 4) + '-';
  await lockDeviceNames(db);
  const r = await db.query<{ last_number: number }>(`
    WITH matching AS (
      SELECT substring(name FROM length($1::text)+1) AS suffix
      FROM device WHERE upper(left(name, length($1::text)))=upper($1)
    ), next AS (
      SELECT greatest($2::bigint, COALESCE(max(suffix::bigint),0)+1) AS n
      FROM matching WHERE suffix ~ '^[0-9]{1,12}$'
    )
    INSERT INTO device_name_counter(stem,last_number) SELECT upper($1), n FROM next
    ON CONFLICT(stem) DO UPDATE SET last_number=greatest(device_name_counter.last_number+1, excluded.last_number)
    RETURNING last_number`, [stem, site.ipad_number_start]);
  return stem + String(r.rows[0]!.last_number).padStart(3, '0');
}

/** Simpan credential terenkripsi + validasi kekuatan & duplikat. */
export async function setCredential(db: Db, deviceId: string, field: string, value: string, userId: string, opt: { enforce?: boolean } = {}): Promise<void> {
  const enforce = opt.enforce ?? true;
  const meta = CRED_FIELDS[field];
  if (!meta) throw bad('Field credential tidak dikenal');
  const v = value.trim();
  if (!v || v.length > 200) throw bad(`${meta.label} tidak valid`);
  const weak = weakReason(v, meta.kind);
  if (enforce && weak) throw bad(`${meta.label} ditolak, ${weak}`, 'WEAK');
  const h = hmac(v, field);
  if (enforce && meta.unique) {
    const dup = await db.query('SELECT 1 FROM device_credential WHERE field=$1 AND hmac=$2 AND device_id<>$3 LIMIT 1', [field, h, deviceId]);
    if (dup.rowCount) throw bad(`${meta.label} sudah dipakai iPad lain, gunakan nilai unik`, 'DUPLICATE_SECRET');
  }
  const cur = await db.query('SELECT hmac FROM device_credential WHERE device_id=$1 AND field=$2', [deviceId, field]);
  if (enforce && meta.sec && cur.rows[0]?.hmac === h) throw bad(`${meta.label} sama dengan nilai lama`);
  await db.query(
    `INSERT INTO device_credential(device_id,field,enc,hmac,weak,updated_by) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (device_id,field) DO UPDATE SET enc=EXCLUDED.enc, hmac=EXCLUDED.hmac, weak=EXCLUDED.weak, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [deviceId, field, encrypt(v, `device:${deviceId}:${field}`), h, !!weak, userId],
  );
  if (field === 'passcode') await db.query('UPDATE device SET passcode_changed=current_date, passcode_default=$2 WHERE id=$1', [deviceId, !!weak]);
  if (field === 'appleId' || field === 'applePwd') await db.query('UPDATE device SET apple_changed=current_date WHERE id=$1', [deviceId]);
}
export async function readCredential(deviceId: string, field: string, user: AuthUser): Promise<string> {
  const scope = deviceScope(user, 'd', 3);
  const r = await one<{ enc: string }>(`SELECT c.enc
    FROM device_credential c JOIN device d ON d.id=c.device_id
    WHERE d.id=$1 AND c.field=$2 AND ${scope.sql}`, [deviceId, field, ...scope.params]);
  return r ? decrypt(r.enc, `device:${deviceId}:${field}`) : '';
}
