import { q, type Db } from '../db.js';
import { decrypt } from '../crypto.js';
import type { Scenario } from './policy.js';

export interface Cond { scenarios?: string[]; lokasi_ids?: number[]; purposes?: string[] }
export interface Step { id: string; text: string; cond?: Cond; skippable?: boolean }
export interface Field { k: string; label: string; target: string; required: boolean }
export interface Guide { id: string; sort: number; title: string; descr: string; required: boolean; cond: Cond; steps: Step[]; fields: Field[]; auto: Record<string, string> }
export interface Ctx { scenario: Scenario; lokasiId: number; purpose: string }
export interface GuideState { done?: boolean; doneAt?: string; doneBy?: string; steps?: Record<string, 'done' | 'skip'> }
export interface Run { id: number; device_id: string; scenario: Scenario; from_lokasi_id: number | null; from_purpose: string | null; state: Record<string, GuideState>; finished_at: string | null }

/** Kondisi kosong = berlaku untuk semua. */
export function applies(c: Cond | undefined, x: Ctx): boolean {
  if (!c) return true;
  if (c.scenarios?.length && !c.scenarios.includes(x.scenario)) return false;
  if (c.lokasi_ids?.length && !c.lokasi_ids.includes(x.lokasiId)) return false;
  if (c.purposes?.length && !c.purposes.includes(x.purpose)) return false;
  return true;
}
export async function allGuides(db: Db = { query: q } as unknown as Db): Promise<Guide[]> {
  return (await db.query('SELECT id, sort, title, descr, required, cond, steps, fields, auto FROM guide ORDER BY sort, title')).rows as Guide[];
}
/** Panduan + langkah yang berlaku untuk iPad ini (skenario, lokasi, peruntukan). */
export function guidesFor(all: Guide[], x: Ctx): Guide[] {
  return all.filter((g) => applies(g.cond, x)).map((g) => ({ ...g, steps: g.steps.filter((s) => applies(s.cond, x)) }));
}
export async function openRun(db: Db, deviceId: string): Promise<Run | null> {
  const r = await db.query('SELECT * FROM config_run WHERE device_id=$1 AND finished_at IS NULL ORDER BY id DESC LIMIT 1', [deviceId]);
  return (r.rows[0] as Run | undefined) ?? null;
}
export function progress(gs: Guide[], st: Record<string, GuideState>): { total: number; done: number; requiredLeft: number } {
  const done = gs.filter((g) => st[g.id]?.done).length;
  return { total: gs.length, done, requiredLeft: gs.filter((g) => g.required && !st[g.id]?.done).length };
}

/** Progress konfigurasi untuk beberapa iPad sekaligus (dipakai di daftar). */
export async function progressMap(devs: { id: string; lokasi_id: number; purpose: string; status: string }[]): Promise<Map<string, { total: number; done: number }>> {
  const m = new Map<string, { total: number; done: number }>();
  const setup = devs.filter((d) => d.status === 'Setup');
  if (!setup.length) return m;
  const all = await allGuides();
  const runs = (await q('SELECT DISTINCT ON (device_id) * FROM config_run WHERE device_id = ANY($1) AND finished_at IS NULL ORDER BY device_id, id DESC', [setup.map((d) => d.id)])).rows as Run[];
  for (const d of setup) {
    const run = runs.find((r) => r.device_id === d.id);
    const gs = guidesFor(all, { scenario: run?.scenario ?? 'baru', lokasiId: d.lokasi_id, purpose: d.purpose });
    const p = progress(gs, run?.state ?? {});
    m.set(d.id, { total: p.total, done: p.done });
  }
  return m;
}

// ---------------------------------------------------------------- variabel
export interface VarDef { key: string; label: string; type: 'text' | 'secret'; qr: boolean; sort: number }
interface VarVal { key: string; lokasi_id: number | null; purpose: string | null; value: string | null; enc: string | null; id: number }
export const varCtx = (v: Pick<VarVal, 'key' | 'id'>) => `var:${v.key}:${v.id}`;

/** Prioritas nilai: lokasi+peruntukan > lokasi > peruntukan > default. */
export async function resolveVars(db: Db, lokasiId: number | null, purpose: string | null): Promise<Record<string, VarDef & { row: VarVal | null }>> {
  const defs = (await db.query('SELECT key,label,type,qr,sort FROM config_var ORDER BY sort,key')).rows as VarDef[];
  const vals = (await db.query('SELECT id,key,lokasi_id,purpose,value,enc FROM config_var_value')).rows as VarVal[];
  const out: Record<string, VarDef & { row: VarVal | null }> = {};
  for (const v of defs) {
    const mine = vals.filter((x) => x.key === v.key);
    const pick =
      mine.find((x) => x.lokasi_id === lokasiId && x.purpose === purpose && lokasiId !== null && purpose !== null) ??
      mine.find((x) => x.lokasi_id === lokasiId && x.purpose === null && lokasiId !== null) ??
      mine.find((x) => x.lokasi_id === null && x.purpose === purpose && purpose !== null) ??
      mine.find((x) => x.lokasi_id === null && x.purpose === null) ??
      null;
    out[v.key] = { ...v, row: pick };
  }
  return out;
}
export function varPlain(v: (VarDef & { row: VarVal | null }) | undefined): string {
  if (!v?.row) return '';
  return v.type === 'secret' ? (v.row.enc ? decrypt(v.row.enc, varCtx(v.row)) : '') : v.row.value ?? '';
}
