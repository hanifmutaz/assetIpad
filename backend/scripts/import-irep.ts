// Import akun i-Reporter (ConMas) dari Excel USER-CONMAS.xlsx.
//   Dry-run (default):  npm run import-irep -- ./USER-CONMAS.xlsx
//   Simpan:             npm run import-irep -- ./USER-CONMAS.xlsx --commit
// Opsi: --lokasi-hrs=Hirose  --lokasi-sgp=SGP  --set-dashboard (iPad berstatus "Dashboard" di sheet "iPad HRS" diubah peruntukannya jadi Dashboard)
// Sumber data:
//   HRS : akun lama  ← "Kelola Akun HRS" (department, status Aktif/Tidak, pengganti) + password dari "User-ConMas-HRS"
//         akun baru  ← "Rencana Akun HRS" (+ password dari "User-ConMas-HRS" kolom After, dicocokkan dengan nama tanpa angka 0 di depan)
//         iPad ↔ akun ← "iPad HRS" (Akun Lama, Akun Baru)
//   SGP : akun lama/baru + password ← "User-ConMas-SGP"
// Aman diulang: akun yang sudah ada dilengkapi (tidak ditimpa), tautan iPad ditambah. Password tidak pernah ditulis ke laporan.
import 'dotenv/config';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { makePool } from '../src/db.js';
import { encrypt } from '../src/crypto.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const COMMIT = args.includes('--commit');
const SET_DASH = args.includes('--set-dashboard');
if (!file || !fs.existsSync(file)) { console.error('Pemakaian: npm run import-irep -- <file.xlsx> [--commit] [--lokasi-hrs=Hirose] [--lokasi-sgp=SGP] [--set-dashboard]'); process.exit(1); }

function plain(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return plain(o.result as ExcelJS.CellValue);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return null;
  }
  return v;
}
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
/** Baca sheet jadi baris-baris array (indeks 1 = kolom A), mulai setelah baris header yang kolom pertamanya = `firstHeader`. */
function table(name: string, firstHeader: string): string[][] {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Sheet "${name}" tidak ada di file`);
  let h = 0;
  ws.eachRow((row, n) => { if (!h && str(plain(row.getCell(1).value)) === firstHeader) h = n; });
  if (!h) throw new Error(`Header "${firstHeader}" tidak ditemukan di sheet "${name}"`);
  const out: string[][] = [];
  for (let n = h + 1; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const cells: string[] = [''];
    for (let i = 1; i <= 20; i++) cells.push(str(plain(row.getCell(i).value)));
    if (cells.some(Boolean)) out.push(cells);
  }
  return out;
}

// "PDHRS01" dan "PDHRS1" dianggap sama (nama di sheet password ditulis tanpa 0 di depan)
const normName = (s: string) => s.toLowerCase().replace(/([a-z])0+(\d)/g, '$1$2');
// "iPad 01" dan "iPad01" → ipad1
const devKey = (s: string) => { const m = s.toLowerCase().replace(/\s+/g, '').match(/^ipad0*(\d+)$/); return m ? `ipad${m[1]}` : s.toLowerCase().replace(/\s+/g, ''); };

interface Acc { kind: 'lama' | 'baru'; username: string; dept: string | null; pwd: string | null; active: boolean; replacedBy: string | null }
const hrs = { lama: new Map<string, Acc>(), baru: new Map<string, Acc>() };
const sgp = { lama: new Map<string, Acc>(), baru: new Map<string, Acc>() };
const links: { device: string; lama: string | null; baru: string | null; status: string }[] = [];
const notes: string[] = [];

const put = (m: Map<string, Acc>, kind: Acc['kind'], username: string, p: Partial<Acc>) => {
  const k = username.toLowerCase();
  const cur = m.get(k) ?? { kind, username, dept: null, pwd: null, active: true, replacedBy: null };
  for (const [key, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') (cur as unknown as Record<string, unknown>)[key] = v;
  m.set(k, cur);
  return cur;
};

// ---- HRS
{
  const uc = table('User-ConMas-HRS', 'No');            // B=User Before C=Pass Before D=User After E=Pass After F=Department
  const pwdBefore = new Map<string, string>(); const pwdAfter = new Map<string, string>();
  for (const r of uc) {
    if (r[2] && r[3] && !pwdBefore.has(r[2].toLowerCase())) pwdBefore.set(r[2].toLowerCase(), r[3]);
    if (r[4] && r[5] && !pwdAfter.has(normName(r[4]))) pwdAfter.set(normName(r[4]), r[5]);
  }
  const kelola = table('Kelola Akun HRS', 'Akun Lama');  // A=Akun Lama B=Dept C=Pengganti D=Status ... L=Akun Baru M=Dept
  const newDept = new Map<string, string>();
  for (const r of kelola) {
    if (r[1]) put(hrs.lama, 'lama', r[1], { dept: r[2], pwd: pwdBefore.get(r[1].toLowerCase()), active: r[4] !== 'Tidak Aktif', replacedBy: r[3] });
    if (r[12] && r[13]) newDept.set(r[12].toLowerCase(), r[13]);
  }
  for (const r of table('Rencana Akun HRS', 'Rencana Akun')) {
    if (!r[1]) continue;
    put(hrs.baru, 'baru', r[1], { dept: newDept.get(r[1].toLowerCase()), pwd: pwdAfter.get(normName(r[1])) });
  }
  for (const a of hrs.lama.values()) {
    if (a.replacedBy && !hrs.baru.has(a.replacedBy.toLowerCase())) { put(hrs.baru, 'baru', a.replacedBy, { dept: newDept.get(a.replacedBy.toLowerCase()) ?? a.dept, pwd: pwdAfter.get(normName(a.replacedBy)) }); notes.push(`Akun baru ${a.replacedBy} (pengganti ${a.username}) tidak ada di Rencana Akun, dibuat`); }
  }
  for (const r of table('iPad HRS', 'iPad')) {
    if (!/^ipad/i.test(r[1])) continue;                 // baris ringkasan di atas tabel
    links.push({ device: r[1], lama: r[2] || null, baru: r[3] || null, status: r[4] });
    if (r[2] && !hrs.lama.has(r[2].toLowerCase())) { put(hrs.lama, 'lama', r[2], {}); notes.push(`Akun lama ${r[2]} hanya ada di sheet iPad HRS (dibuat tanpa department)`); }
    if (r[3] && !hrs.baru.has(r[3].toLowerCase())) { put(hrs.baru, 'baru', r[3], { pwd: pwdAfter.get(normName(r[3])) }); notes.push(`Akun baru ${r[3]} tidak ada di Rencana Akun (dibuat dari sheet iPad HRS)`); }
  }
}
// ---- SGP
{
  for (const r of table('User-ConMas-SGP', 'No')) {
    if (r[2]) put(sgp.lama, 'lama', r[2], { dept: r[6], pwd: r[3] });
    if (r[4]) put(sgp.baru, 'baru', r[4], { dept: r[6], pwd: r[5] });
  }
}

const pool = makePool(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL);
const c = await pool.connect();
const report: string[][] = [['Lokasi', 'Jenis', 'Item', 'Hasil', 'Catatan']];
const cnt = { akunBaruDibuat: 0, akunDiperbarui: 0, tautan: 0, tautanDilewati: 0, pwd: 0, dashboard: 0 };
const createdDept = new Set<string>();

try {
  await c.query('BEGIN');
  const lokNames: [string, typeof hrs][] = [[opt('lokasi-hrs', 'Hirose'), hrs], [opt('lokasi-sgp', 'SGP'), sgp]];
  const lok = new Map<string, number>((await c.query('SELECT id,name FROM lokasi')).rows.map((r) => [String(r.name).toLowerCase(), r.id as number]));
  const depts = new Map<string, number>((await c.query('SELECT id,name FROM department')).rows.map((r) => [String(r.name).toLowerCase(), r.id as number]));
  const deptId = async (n: string | null): Promise<number | null> => {
    if (!n) return null;
    let id = depts.get(n.toLowerCase());
    if (!id) { id = (await c.query('INSERT INTO department(name) VALUES($1) RETURNING id', [n]) ).rows[0].id as number; depts.set(n.toLowerCase(), id); createdDept.add(n); }
    return id;
  };
  const devs = (await c.query('SELECT d.id, d.name, s.lokasi_id FROM device d JOIN section s ON s.id=d.section_id WHERE d.name IS NOT NULL')).rows as { id: string; name: string; lokasi_id: number }[];

  const idOf = new Map<string, number>();   // "lokasiId|kind|username" → id akun
  for (const [lname, set] of lokNames) {
    const lokId = lok.get(lname.toLowerCase());
    if (!lokId) { report.push([lname, '-', '-', 'DILEWATI', `lokasi "${lname}" tidak ada di database`]); continue; }
    for (const acc of [...set.lama.values(), ...set.baru.values()]) {
      const dId = await deptId(acc.dept);
      const ex = (await c.query('SELECT id, pwd_enc, department_id FROM irep_account WHERE lokasi_id=$1 AND kind=$2 AND lower(username)=lower($3)', [lokId, acc.kind, acc.username])).rows[0];
      let aid: number;
      if (ex) {
        aid = ex.id as number;
        await c.query('UPDATE irep_account SET department_id=COALESCE(department_id,$2), active=$3, updated_at=now() WHERE id=$1', [aid, dId, acc.active]);
        cnt.akunDiperbarui++;
      } else {
        aid = (await c.query('INSERT INTO irep_account(lokasi_id,kind,username,department_id,active) VALUES($1,$2,$3,$4,$5) RETURNING id', [lokId, acc.kind, acc.username, dId, acc.active])).rows[0].id as number;
        cnt.akunBaruDibuat++;
      }
      if (acc.pwd && !(ex && ex.pwd_enc)) { await c.query('UPDATE irep_account SET pwd_enc=$2, pwd_changed_at=now() WHERE id=$1', [aid, encrypt(acc.pwd, `irep:${aid}`)]); cnt.pwd++; }
      else if (!acc.pwd) report.push([lname, acc.kind, acc.username, 'TANPA PASSWORD', 'password tidak ditemukan di sheet User-ConMas']);
      idOf.set(`${lokId}|${acc.kind}|${acc.username.toLowerCase()}`, aid);
    }
    // pengganti (akun lama → akun baru)
    for (const acc of set.lama.values()) {
      if (!acc.replacedBy) continue;
      const from = idOf.get(`${lokId}|lama|${acc.username.toLowerCase()}`);
      const to = idOf.get(`${lokId}|baru|${acc.replacedBy.toLowerCase()}`);
      if (from && to) await c.query('UPDATE irep_account SET replaced_by=$2 WHERE id=$1', [from, to]);
      else report.push([lname, 'lama', acc.username, 'PENGGANTI TIDAK DITEMUKAN', `akun pengganti "${acc.replacedBy}" tidak ada di daftar akun baru`]);
    }
  }

  // tautan iPad ↔ akun (hanya HRS)
  const hrsLokId = lok.get(opt('lokasi-hrs', 'Hirose').toLowerCase());
  if (hrsLokId) {
    const byKey = new Map<string, { id: string }[]>();
    for (const d of devs.filter((x) => x.lokasi_id === hrsLokId)) byKey.set(devKey(d.name), [...(byKey.get(devKey(d.name)) ?? []), { id: d.id }]);
    for (const l of links) {
      const hit = byKey.get(devKey(l.device));
      if (!hit) { cnt.tautanDilewati++; report.push([opt('lokasi-hrs', 'Hirose'), 'iPad', l.device, 'DILEWATI', 'iPad belum ada di database (impor iPad dulu)']); continue; }
      if (hit.length > 1) { cnt.tautanDilewati++; report.push([opt('lokasi-hrs', 'Hirose'), 'iPad', l.device, 'DILEWATI', 'nama iPad ganda di database']); continue; }
      const dev = hit[0]!.id;
      for (const [kind, name] of [['lama', l.lama], ['baru', l.baru]] as const) {
        if (!name) continue;
        const aid = idOf.get(`${hrsLokId}|${kind}|${name.toLowerCase()}`);
        if (!aid) continue;
        // satu iPad hanya satu akun per jenis; kalau sudah terhubung ke akun lain biarkan
        const taken = await c.query('SELECT 1 FROM irep_account_device x JOIN irep_account a ON a.id=x.account_id WHERE x.device_id=$1 AND a.kind=$2 AND a.id<>$3', [dev, kind, aid]);
        if (taken.rowCount) { cnt.tautanDilewati++; report.push([opt('lokasi-hrs', 'Hirose'), 'iPad', l.device, 'DILEWATI', `sudah terhubung ke akun ${kind} lain`]); continue; }
        const r = await c.query('INSERT INTO irep_account_device(account_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [aid, dev]);
        if (r.rowCount) cnt.tautan++;
      }
      if (SET_DASH && /dashboard/i.test(l.status)) {
        await c.query("INSERT INTO master_item(kind,value,sort) VALUES('purpose','Dashboard',(SELECT COALESCE(max(sort),0)+1 FROM master_item WHERE kind='purpose')) ON CONFLICT DO NOTHING");
        const u = await c.query("UPDATE device SET purpose='Dashboard', updated_at=now(), version=version+1 WHERE id=$1 AND purpose<>'Dashboard'", [dev]);
        if (u.rowCount) { cnt.dashboard++; report.push([opt('lokasi-hrs', 'Hirose'), 'iPad', l.device, 'PERUNTUKAN → Dashboard', '']); }
      }
    }
    // akun yang dipakai lebih dari 2 iPad (peringatan saja)
    const over = await c.query("SELECT a.username, a.kind, count(*)::int n FROM irep_account a JOIN irep_account_device x ON x.account_id=a.id WHERE a.lokasi_id=$1 GROUP BY a.id HAVING count(*)>2", [hrsLokId]);
    for (const r of over.rows) report.push([opt('lokasi-hrs', 'Hirose'), r.kind, r.username, 'MELEBIHI BATAS', `dipakai ${r.n} iPad (maks 2)`]);
  }
  if (COMMIT) await c.query('COMMIT'); else await c.query('ROLLBACK');
} catch (err) {
  await c.query('ROLLBACK').catch(() => undefined);
  console.error('\n✗ Dibatalkan, tidak ada yang tersimpan:', (err as Error).message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}

const csv = report.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
const out = `import-irep-report-${new Date().toISOString().slice(0, 10)}.csv`;
fs.writeFileSync(out, `﻿${csv}`);
console.log(`\n${COMMIT ? '✓ DISIMPAN' : '○ DRY-RUN (tidak ada yang disimpan; tambahkan --commit untuk menyimpan)'}`);
console.log(`  Akun baru dibuat   : ${cnt.akunBaruDibuat}   (sudah ada/diperbarui: ${cnt.akunDiperbarui})`);
console.log(`  Password terenkripsi: ${cnt.pwd}`);
console.log(`  Tautan iPad ↔ akun : ${cnt.tautan}   (dilewati: ${cnt.tautanDilewati})`);
if (SET_DASH) console.log(`  iPad → Dashboard   : ${cnt.dashboard}`);
if (createdDept.size) console.log(`  Department baru   : ${[...createdDept].join(', ')}`);
for (const n of [...new Set(notes)]) console.log(`  ! ${n}`);
console.log(`  Laporan rinci      : ${out}`);
