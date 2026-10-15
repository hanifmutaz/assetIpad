import { q } from '../db.js';
import { forbidden } from '../errors.js';
import { CRED_FIELDS } from './policy.js';

/** SQL kondisi "device d berada dalam scope PIC $n" (scope section aktif atau assign per-iPad). */
export const scopeSql = (alias, param) => `(
  EXISTS (SELECT 1 FROM pic_scope ps WHERE ps.user_id=${param} AND ps.section_id=${alias}.section_id
          AND ps.start_date<=current_date AND (ps.end_date IS NULL OR ps.end_date>=current_date))
  OR EXISTS (SELECT 1 FROM pic_device pd WHERE pd.user_id=${param} AND pd.device_id=${alias}.id))`;

export async function inScope(user, deviceId) {
  if (!user || user.role !== 'pic') return false;
  const r = await q(`SELECT 1 FROM device d WHERE d.id=$1 AND ${scopeSql('d', '$2')}`, [deviceId, user.id]);
  return r.rowCount > 0;
}

export async function credFieldsFor(user, deviceId) {
  if (user.role === 'admin') return Object.keys(CRED_FIELDS);
  if (user.role === 'pic' && (await inScope(user, deviceId))) return Object.keys(CRED_FIELDS).filter((k) => !CRED_FIELDS[k].adm);
  return [];
}

export async function assertCredField(user, deviceId, field) {
  if (!CRED_FIELDS[field]) throw forbidden('Field tidak dikenal');
  const allowed = await credFieldsFor(user, deviceId);
  if (!allowed.includes(field)) throw forbidden('Anda tidak berhak mengakses credential ini');
}

export async function canHandleTicket(user, deviceId) {
  if (user.role === 'admin') return true;
  return user.role === 'pic' && inScope(user, deviceId);
}
