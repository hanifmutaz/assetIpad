import type { Request } from 'express';
import { q, type Db } from '../db.js';
import { getRules } from './rules.js';
import { logger } from '../logger.js';
import type { AuthUser } from '../types.js';

export interface AuditEntry { action: string; deviceId?: string | null; target?: string | null; reason?: string | null }

/** Audit log append-only (trigger menolak UPDATE/DELETE). */
export async function audit(req: Request, e: AuditEntry, db: Db = { query: q } as unknown as Db, who?: Pick<AuthUser, 'id' | 'name' | 'role'>): Promise<void> {
  const u = who ?? req.user;
  await db.query(
    'INSERT INTO audit_log(user_id,user_name,role,action,device_id,target,reason,ip,user_agent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [u?.id ?? null, u?.name ?? 'anonim', u?.role ?? null, e.action, e.deviceId ?? null, e.target ?? null, e.reason ?? null, req.ip ?? null, (req.get('user-agent') ?? '').slice(0, 300)],
  );
  if (u && /^(Lihat|Salin|QR)/.test(e.action)) await burstCheck(u).catch((err) => logger.error(err, 'burstCheck'));
}

async function burstCheck(u: Pick<AuthUser, 'id' | 'name'>): Promise<void> {
  const R = await getRules();
  const n = (await q<{ n: number }>("SELECT count(*)::int n FROM audit_log WHERE user_id=$1 AND action ~ '^(Lihat|Salin|QR)' AND at > now() - make_interval(mins => $2)", [u.id, R.burstMin])).rows[0]?.n ?? 0;
  if (n < R.burstCount) return;
  const dup = await q('SELECT 1 FROM access_alert WHERE user_id=$1 AND at > now() - make_interval(mins => $2)', [u.id, R.burstMin]);
  if (dup.rowCount) return;
  await q('INSERT INTO access_alert(user_id,user_name,count,text) VALUES($1,$2,$3,$4)', [u.id, u.name, n, `${u.name} membuka ${n} data rahasia dalam ${R.burstMin} menit`]);
}

export async function history(db: Db, deviceId: string, user: Pick<AuthUser, 'id' | 'name'> | undefined, action: string, toStatus: string | null = null): Promise<void> {
  await db.query('INSERT INTO device_history(device_id,by_user,by_name,action,to_status) VALUES($1,$2,$3,$4,$5)', [deviceId, user?.id ?? null, user?.name ?? 'Sistem', action, toStatus]);
}
