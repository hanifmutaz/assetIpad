import { q } from '../db.js';

export const DEFAULT_RULES = { escalateDays: 3, staleDays: 90, maxAgeYears: 6, targetIOS: '18.7.9', lockMin: 5, burstCount: 5, burstMin: 10, prefix: 'iPad' };
let cache = null;
let at = 0;

export async function getRules() {
  if (cache && Date.now() - at < 30000) return cache;
  const r = await q("SELECT value FROM app_setting WHERE key='rules'");
  cache = { ...DEFAULT_RULES, ...(r.rows[0]?.value || {}) };
  at = Date.now();
  return cache;
}
export const clearRules = () => { cache = null; };

export async function getMaster(kind) {
  const r = await q('SELECT value FROM master_item WHERE kind=$1 ORDER BY sort, value', [kind]);
  return r.rows.map((x) => x.value);
}
