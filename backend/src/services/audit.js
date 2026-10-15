import { q } from '../db.js';
import { getRules } from './rules.js';
import { logger } from '../logger.js';

/** Audit log append-only (tabel dilindungi trigger: tidak bisa UPDATE/DELETE). */
export async function audit(req, { action, deviceId = null, target = null, reason = null }, client) {
  const u = req.user;
  const db = client || { query: q };
  await db.query(
    `INSERT INTO audit_log(user_id,user_name,role,action,device_id,target,reason,ip,user_agent)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [u?.id || null, u?.name || 'anonim', u?.role || null, action, deviceId, target, reason, req.ip || null, (req.get('user-agent') || '').slice(0, 300)],
  );
  if (u && /^(Lihat|Salin|QR)/.test(action)) await burstCheck(u).catch((e) => logger.error(e, 'burstCheck'));
}

async function burstCheck(u) {
  const R = await getRules();
  const { rows } = await q(
    `SELECT count(*)::int n FROM audit_log WHERE user_id=$1 AND action ~ '^(Lihat|Salin|QR)' AND at > now() - make_interval(mins => $2)`,
    [u.id, R.burstMin],
  );
  const n = rows[0].n;
  if (n < R.burstCount) return;
  const dup = await q(`SELECT 1 FROM access_alert WHERE user_id=$1 AND at > now() - make_interval(mins => $2)`, [u.id, R.burstMin]);
  if (dup.rowCount) return;
  await q('INSERT INTO access_alert(user_id,user_name,count,text) VALUES($1,$2,$3,$4)', [
    u.id, u.name, n, `${u.name} membuka ${n} data rahasia dalam ${R.burstMin} menit`,
  ]);
  logger.warn({ user: u.email, n }, 'Akses credential tidak wajar');
}

export async function history(client, deviceId, user, action, toStatus = null) {
  await client.query('INSERT INTO device_history(device_id,by_user,by_name,action,to_status) VALUES($1,$2,$3,$4,$5)', [
    deviceId, user?.id || null, user?.name || 'Sistem', action, toStatus,
  ]);
}
