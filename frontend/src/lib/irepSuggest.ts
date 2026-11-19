// Usulan pasangan migrasi akun i-Reporter (logika murni, tanpa React, supaya mudah diuji).
// Input: akun lama + akun baru dalam SATU lokasi. Output: baris "pindahkan iPad X dan Y ke akun Z".
// Aturan keras: maks `max` iPad per akun baru, dan semua iPad dalam satu akun baru satu department
// (supaya authority akun jelas). iPad dikelompokkan per department, lalu per section agar pasangannya berdekatan.
export interface SDev { id: string; name: string; department_id: number; department: string; section: string }
export interface SAcc { id: number; kind: 'lama' | 'baru'; username: string; department_id: number | null; department?: string | null; devices: SDev[] }
export interface Suggestion {
  key: string;
  devices: SDev[];
  /** akun baru yang sudah ada (slotnya diisi); null = perlu dibuat dengan nama `suggested` */
  target: { id: number; username: string } | null;
  suggested: string;
  departmentId: number;
  department: string;
  from: string[];
  /** akun lama yang seluruh iPad-nya sudah punya akun baru setelah baris ini (dihitung dari atas ke bawah) */
  frees: string[];
}

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
/** "PDHRS01" dan "PDHRS1" dianggap nama yang sama (aturan yang sama dengan script import-irep). */
export const normName = (s: string) => s.trim().toLowerCase().replace(/([a-z])0+(\d)/g, '$1$2');
const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function commonSuffix(list: string[]): string {
  if (list.length < 2) return ''; // satu contoh saja = seluruh nama, bukan akhiran
  let s = list[0]!;
  for (const x of list) { while (s && !x.endsWith(s)) s = s.slice(1); }
  return s.length >= 2 ? s : '';
}

/** Awalan nama akun baru per department, dipelajari dari akun baru yang sudah ada (mis. PDHRS01 → "PDHRS"). */
function stemsByDept(baru: SAcc[], deptOf: (a: SAcc) => number | null): { byDept: Map<number, string>; suffix: string } {
  const count = new Map<number, Map<string, number>>();
  const all: string[] = [];
  for (const a of baru) {
    const stem = a.username.trim().toUpperCase().replace(/\d+$/, '');
    const d = deptOf(a);
    if (!stem) continue;
    all.push(stem);
    if (d === null) continue;
    const m = count.get(d) ?? new Map<string, number>();
    m.set(stem, (m.get(stem) ?? 0) + 1);
    count.set(d, m);
  }
  const byDept = new Map<number, string>();
  for (const [d, m] of count) byDept.set(d, [...m.entries()].sort((x, y) => y[1] - x[1] || natural(x[0], y[0]))[0]![0]);
  // Kode lokasi (mis. "HRS"): sisa nama setelah kode department ("ALHRS" untuk department AL → "HRS"); bila tidak bisa, akhiran bersama beberapa contoh.
  const rest = new Map<string, number>();
  for (const a of baru) {
    const dn = a.department ? alnum(a.department) : '';
    const stem = a.username.trim().toUpperCase().replace(/\d+$/, '');
    if (dn && stem.startsWith(dn) && stem.length - dn.length >= 2) { const r = stem.slice(dn.length); rest.set(r, (rest.get(r) ?? 0) + 1); }
  }
  const fromDept = [...rest.entries()].sort((x, y) => y[1] - x[1] || natural(x[0], y[0]))[0]?.[0];
  return { byDept, suffix: fromDept ?? commonSuffix(all) };
}

export function buildSuggestions(accounts: SAcc[], max: number): Suggestion[] {
  const lama = accounts.filter((a) => a.kind === 'lama');
  const baru = accounts.filter((a) => a.kind === 'baru');
  const inBaru = new Set(baru.flatMap((a) => a.devices.map((d) => d.id)));

  // iPad yang belum punya akun baru
  const fromOf = new Map<string, string>();
  const pending: SDev[] = [];
  for (const a of lama) for (const d of a.devices) if (!inBaru.has(d.id) && !fromOf.has(d.id)) { fromOf.set(d.id, a.username); pending.push(d); }

  // department akun baru: yang tercatat, atau (bila kosong) department iPad-nya bila seragam
  const deptOf = (a: SAcc): number | null => {
    if (a.department_id !== null) return a.department_id;
    const ds = new Set(a.devices.map((d) => d.department_id));
    return ds.size === 1 ? [...ds][0]! : null;
  };
  const { byDept, suffix } = stemsByDept(baru, deptOf);
  const taken = new Set(accounts.map((a) => normName(a.username)));
  const nextName = (stem: string): string => {
    for (let n = 1; n < 1000; n++) {
      const c = `${stem}${String(n).padStart(2, '0')}`;
      if (!taken.has(normName(c))) { taken.add(normName(c)); return c; }
    }
    throw new Error('Nomor akun habis');
  };

  const groups = new Map<number, SDev[]>();
  for (const d of pending) groups.set(d.department_id, [...(groups.get(d.department_id) ?? []), d]);
  for (const g of groups.values()) g.sort((a, b) => natural(a.section, b.section) || natural(a.name, b.name));

  type Raw = { devices: SDev[]; target: { id: number; username: string } | null; deptId: number; suggested: string };
  const raw: Raw[] = [];
  for (const [deptId, list] of groups) {
    const rest = [...list];
    // A. isi slot akun baru yang sudah ada dan department-nya sama (yang sudah terisi 1 iPad dulu, lalu yang kosong)
    const targets = baru
      .filter((a) => deptOf(a) === deptId && a.devices.length < max)
      .sort((a, b) => b.devices.length - a.devices.length || natural(a.username, b.username));
    for (const t of targets) {
      if (!rest.length) break;
      const take = rest.splice(0, max - t.devices.length);
      raw.push({ devices: take, target: { id: t.id, username: t.username }, deptId, suggested: t.username });
    }
    // B. sisanya dipasangkan jadi akun baru
    const dept = list[0]!.department;
    const stem = byDept.get(deptId) ?? `${alnum(dept)}${suffix && !alnum(dept).endsWith(suffix) ? suffix : ''}`;
    for (let i = 0; i < rest.length; i += max) raw.push({ devices: rest.slice(i, i + max), target: null, deptId, suggested: nextName(stem) });
  }

  // Urutan: baris yang paling cepat menuntaskan akun lama ditaruh paling atas (greedy), supaya akun lama bisa segera dihapus di ConMas.
  const left = new Map<string, Set<string>>(); // akun lama → iPad yang belum punya akun baru
  for (const a of lama) left.set(a.username, new Set(a.devices.filter((d) => !inBaru.has(d.id)).map((d) => d.id)));
  const doneNow = (r: Raw, migrated: Set<string>) => [...left].filter(([, s]) => s.size && [...s].every((id) => migrated.has(id) || r.devices.some((d) => d.id === id))).map(([u]) => u);
  const migrated = new Set<string>();
  const freed = new Set<string>();
  const queue = [...raw];
  const out: Suggestion[] = [];
  while (queue.length) {
    let best = 0, bestN = -1;
    queue.forEach((r, i) => {
      const n = doneNow(r, migrated).filter((u) => !freed.has(u)).length;
      if (n > bestN || (n === bestN && r.target && !queue[best]!.target)) { best = i; bestN = n; }
    });
    const r = queue.splice(best, 1)[0]!;
    r.devices.forEach((d) => migrated.add(d.id));
    const frees = doneNow(r, migrated).filter((u) => !freed.has(u));
    frees.forEach((u) => freed.add(u));
    out.push({
      key: r.devices.map((d) => d.id).join(','), devices: r.devices, target: r.target, suggested: r.suggested,
      departmentId: r.deptId, department: r.devices[0]!.department, from: [...new Set(r.devices.map((d) => fromOf.get(d.id)!))], frees,
    });
  }
  return out;
}
