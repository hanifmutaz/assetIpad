// Import iPad dari Excel lama (sheet "Master Data").
//   Dry-run (default, tidak menyimpan apa pun):  npm run import-ipad -- ./iPad_List.xlsx
//   Simpan sungguhan:                            npm run import-ipad -- ./iPad_List.xlsx --commit
// Opsi:
//   --sheet="Master Data"                 nama sheet sumber
//   --by=email@hirose.co.id               akun Super Admin yang dicatat sebagai pengubah (default: Super Admin aktif pertama)
//   --dashboard-apple=a@x.com,b@x.com     iPad dengan Apple ID ini diberi peruntukan "Dashboard" (default semua "i-Reporter")
// Aman diulang: iPad dengan serial yang sudah ada dilewati. Dry-run menjalankan semua insert lalu ROLLBACK,
// jadi hasilnya (termasuk error constraint) sama persis dengan --commit.
import 'dotenv/config';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { makePool } from '../src/db.js';
import { setCredential } from '../src/services/devices.js';
import { mapRow, normHeader, type Row, type Mapped } from './lib/ipad-import-map.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const COMMIT = args.includes('--commit');
if (!file || !fs.existsSync(file)) {
  console.error('Pemakaian: npm run import-ipad -- <file.xlsx> [--commit] [--sheet="Master Data"] [--by=email] [--dashboard-apple=a@x,b@x]');
  process.exit(1);
}

/** Nilai sel exceljs → nilai biasa (rumus, rich text, hyperlink). */
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

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheetName = opt('sheet') ?? 'Master Data';
const ws = wb.getWorksheet(sheetName);
if (!ws) { console.error(`Sheet "${sheetName}" tidak ada. Sheet tersedia: ${wb.worksheets.map((w) => w.name).join(', ')}`); process.exit(1); }

let headerRow = 0;
ws.eachRow((row, n) => { if (!headerRow && row.values && (row.values as unknown[]).some((v) => normHeader(plain(v as ExcelJS.CellValue)) === 'IPAD NAME')) headerRow = n; });
if (!headerRow) { console.error('Baris header (kolom "IPAD NAME") tidak ditemukan'); process.exit(1); }
const heads: string[] = [];
ws.getRow(headerRow).eachCell({ includeEmpty: true }, (c, i) => { heads[i] = normHeader(plain(c.value)); });
const rows: Row[] = [];
for (let n = headerRow + 1; n <= ws.rowCount; n++) {
  const r: Row = {};
  let any = false;
  ws.getRow(n).eachCell({ includeEmpty: false }, (c, i) => {
    const h = heads[i];
    const v = plain(c.value);
    if (h && !(h in r) && v !== null && v !== '') { r[h] = v; any = true; }
  });
  if (any) rows.push(r);
}

const dashApple = new Set((opt('dashboard-apple') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
let mapped: Mapped[] = [];

const pool = makePool(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL);
const c = await pool.connect();
const report: string[][] = [['NO', 'iPad', 'Serial', 'Hasil', 'Catatan']];
const count = { tempSerial: 0, imported: 0, skippedExisting: 0, rejected: 0, failed: 0, creds: 0 };
const created = { section: new Set<string>(), department: new Set<string>(), master: new Set<string>() };

try {
  await c.query('BEGIN');
  await c.query("SET TIME ZONE 'Asia/Jakarta'");

  const by = opt('by')
    ? (await c.query('SELECT id,name FROM app_user WHERE email=$1 AND active', [opt('by')!.toLowerCase()])).rows[0]
    : (await c.query("SELECT id,name FROM app_user WHERE role='superadmin' AND active ORDER BY created_at LIMIT 1")).rows[0];
  if (!by) throw new Error('Tidak ada Super Admin aktif. Jalankan npm run create-superadmin dulu, atau pakai --by=email');

  // iPad tanpa serial tetap diimpor dengan serial sementara TEMP0001, TEMP0002, ... (lanjut dari yang sudah ada di DB).
  let tempN = Number((await c.query("SELECT COALESCE(max(substring(serial from 5)::int),0) n FROM device WHERE serial ~ '^TEMP[0-9]{4}$'")).rows[0].n);
  const placeholderSerial = () => `TEMP${String(++tempN).padStart(4, '0')}`;
  mapped = rows.map((r) => mapRow(r, { dashboardApple: dashApple, placeholderSerial }));

  const lokasi = new Map<string, number>((await c.query('SELECT id,name FROM lokasi')).rows.map((r) => [String(r.name).toLowerCase(), r.id as number]));
  const sections = new Map<string, number>((await c.query('SELECT id,lokasi_id,name FROM section')).rows.map((r) => [`${r.lokasi_id}|${String(r.name).toLowerCase()}`, r.id as number]));
  const depts = new Map<string, number>((await c.query('SELECT id,name FROM department')).rows.map((r) => [String(r.name).toLowerCase(), r.id as number]));
  const master = new Map<string, string>((await c.query('SELECT kind,value FROM master_item')).rows.map((r) => [`${r.kind}|${String(r.value).toLowerCase()}`, r.value as string]));
  const canon = async (kind: string, v: string | null): Promise<string | null> => {
    if (!v) return null;
    const k = `${kind}|${v.toLowerCase()}`;
    const hit = master.get(k);
    if (hit) return hit;
    await c.query('INSERT INTO master_item(kind,value,sort) VALUES($1,$2,(SELECT COALESCE(max(sort),0)+1 FROM master_item WHERE kind=$1)) ON CONFLICT DO NOTHING', [kind, v]);
    master.set(k, v);
    created.master.add(`${kind}: ${v}`);
    return v;
  };

  for (const m of mapped) {
    if (!m.ok) { count.rejected++; report.push([String(m.no ?? ''), m.name ?? '', '', 'DITOLAK', m.reason]); continue; }
    const d = m.device;
    await c.query('SAVEPOINT row');
    try {
      const exist = await c.query('SELECT 1 FROM device WHERE serial=$1', [d.serial]);
      if (exist.rowCount) { count.skippedExisting++; report.push([String(m.no), d.name ?? '', d.serial, 'DILEWATI', 'serial sudah ada di database']); await c.query('RELEASE SAVEPOINT row'); continue; }

      const lokId = lokasi.get(d.lokasi.toLowerCase());
      if (!lokId) throw new Error(`lokasi "${d.lokasi}" tidak ada di database (buat dulu di Pengaturan › Lokasi)`);
      const sk = `${lokId}|${d.section.toLowerCase()}`;
      let secId = sections.get(sk);
      if (!secId) {
        secId = (await c.query('INSERT INTO section(lokasi_id,name) VALUES($1,$2) RETURNING id', [lokId, d.section])).rows[0].id as number;
        sections.set(sk, secId); created.section.add(`${d.lokasi} › ${d.section}`);
      }
      let depId = depts.get(d.department.toLowerCase());
      if (!depId) {
        depId = (await c.query('INSERT INTO department(name) VALUES($1) RETURNING id', [d.department])).rows[0].id as number;
        depts.set(d.department.toLowerCase(), depId); created.department.add(d.department);
      }
      const model = (await canon('model', d.model))!;
      const capacity = await canon('capacity', d.capacity);
      const vendor = await canon('vendor', d.vendor);
      const wifi = await canon('wifi', d.wifi);
      const purpose = (await canon('purpose', d.purpose))!;

      const ins = await c.query(
        `INSERT INTO device(serial,name,section_id,department_id,purpose,model,capacity,color,user_name,arrival,vendor,price,status,wifi,ip,conmas_id,ireporter_user,apple_status,apple_changed,note,passcode_default)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false) RETURNING id`,
        [d.serial, d.name, secId, depId, purpose, model, capacity, d.color, d.userName, d.arrival, vendor, d.price, d.status, wifi, d.ip, d.conmasId, d.ireporterUser, d.appleStatus, d.appleChanged, d.note]);
      const id = ins.rows[0].id as string;

      // Kredensial dienkripsi dengan mekanisme aplikasi (AES-256-GCM). enforce:false = data lama diterima apa adanya,
      // nilai lemah (mis. 123456) ditandai weak sehingga muncul di peringatan "passcode masih default".
      for (const [field, value] of Object.entries(m.creds)) { await setCredential(c, id, field, value, by.id as string, { enforce: false }); count.creds++; }
      await c.query('UPDATE device SET passcode_changed=NULL, apple_changed=$2 WHERE id=$1', [id, d.appleChanged]);
      await c.query("INSERT INTO device_history(device_id,by_user,by_name,action,to_status) VALUES($1,$2,$3,'Diimpor dari Excel lama',$4)", [id, by.id, by.name, d.status]);

      if (/^TEMP[0-9]{4}$/.test(d.serial)) count.tempSerial++;
      count.imported++;
      report.push([String(m.no), d.name ?? '', d.serial, 'DIIMPOR', m.warnings.join('; ')]);
      await c.query('RELEASE SAVEPOINT row');
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT row');
      count.failed++;
      report.push([String(m.no), d.name ?? '', d.serial, 'GAGAL', (err as Error).message]);
    }
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

// Laporan TIDAK berisi password / passcode.
const csv = report.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
const out = `import-report-${new Date().toISOString().slice(0, 10)}.csv`;
fs.writeFileSync(out, `﻿${csv}`);
console.log(`\n${COMMIT ? '✓ DISIMPAN' : '○ DRY-RUN (tidak ada yang disimpan; tambahkan --commit untuk menyimpan)'}`);
console.log(`  Diimpor        : ${count.imported}  (${count.creds} credential terenkripsi)`);
console.log(`  Sudah ada      : ${count.skippedExisting}`);
console.log(`  Ditolak        : ${count.rejected}  (data tidak lengkap)`);
console.log(`  Gagal          : ${count.failed}`);
if (created.section.size) console.log(`  Section baru   : ${[...created.section].join(', ')}`);
if (created.department.size) console.log(`  Department baru: ${[...created.department].join(', ')}`);
if (created.master.size) console.log(`  Master data baru: ${[...created.master].join(', ')}`);
console.log(`  Laporan rinci  : ${out}`);
