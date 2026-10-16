import { one } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import type { AuthUser } from '../types.js';
import { can, CRED_FIELDS } from './policy.js';

/** Admin Department hanya melihat iPad di department-nya. Kembalikan klausa SQL + param. */
export function deviceScope(u: AuthUser, alias: string, nextParam: number): { sql: string; params: unknown[] } {
  if (can(u, 'device.viewAll')) return { sql: 'true', params: [] };
  return { sql: `${alias}.department_id = ANY($${nextParam}::int[])`, params: [u.dept_ids] };
}

export async function assertDeviceVisible(u: AuthUser, deviceId: string): Promise<{ department_id: number }> {
  const d = await one<{ department_id: number }>('SELECT department_id FROM device WHERE id=$1', [deviceId]);
  if (!d) throw notFound('iPad tidak ditemukan');
  if (!can(u, 'device.viewAll') && !u.dept_ids.includes(d.department_id)) throw notFound('iPad tidak ditemukan');
  return d;
}

export async function credFieldsFor(u: AuthUser, deviceId: string): Promise<string[]> {
  if (can(u, 'cred.all')) return Object.keys(CRED_FIELDS);
  if (can(u, 'cred.dept')) {
    const d = await one<{ department_id: number }>('SELECT department_id FROM device WHERE id=$1', [deviceId]);
    if (d && u.dept_ids.includes(d.department_id)) return Object.keys(CRED_FIELDS).filter((k) => CRED_FIELDS[k]!.dept);
  }
  return [];
}
export async function assertCredField(u: AuthUser, deviceId: string, field: string): Promise<void> {
  if (!CRED_FIELDS[field]) throw forbidden('Field tidak dikenal');
  if (!(await credFieldsFor(u, deviceId)).includes(field)) throw forbidden('Anda tidak berhak mengakses credential ini');
}
export function canHandleTicket(u: AuthUser, deptId: number): boolean {
  return can(u, 'ticket.handleAll') || (can(u, 'ticket.handleDept') && u.dept_ids.includes(deptId));
}
