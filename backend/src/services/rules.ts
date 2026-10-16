import { q } from '../db.js';

export interface Rules {
  escalateDays: number; staleDays: number; maxAgeYears: number; targetIOS: string;
  lockMin: number; burstCount: number; burstMin: number; prefix: string;
}
export const DEFAULT_RULES: Rules = { escalateDays: 3, staleDays: 90, maxAgeYears: 6, targetIOS: '18.7.9', lockMin: 5, burstCount: 5, burstMin: 10, prefix: 'iPad' };
let cache: Rules | null = null;
let at = 0;
export async function getRules(): Promise<Rules> {
  if (cache && Date.now() - at < 30000) return cache;
  const r = await q<{ value: Partial<Rules> }>("SELECT value FROM app_setting WHERE key='rules'");
  cache = { ...DEFAULT_RULES, ...(r.rows[0]?.value ?? {}) };
  at = Date.now();
  return cache;
}
export const clearRules = () => { cache = null; };
export async function getMaster(kind: string): Promise<string[]> {
  return (await q<{ value: string }>('SELECT value FROM master_item WHERE kind=$1 ORDER BY sort, value', [kind])).rows.map((x) => x.value);
}
