import type { Db } from '../db.js';

export async function revokeAccountAccess(db: Db, userId: string, exceptSid?: string): Promise<void> {
  await db.query('UPDATE password_reset SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [userId]);
  await db.query("DELETE FROM session WHERE (sess->>'userId')=$1 AND ($2::text IS NULL OR sid<>$2)", [userId, exceptSid ?? null]);
}
