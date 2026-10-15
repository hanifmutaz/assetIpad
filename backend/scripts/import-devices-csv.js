// Migrasi dari Excel: simpan sheet Master Data sebagai CSV (UTF-8), lalu:
//   node scripts/import-devices-csv.js data.csv            → uji coba (dry-run, tidak menyimpan)
//   node scripts/import-devices-csv.js data.csv --commit   → simpan ke database
// Kolom wajib (header baris 1): Nama, Serial, Lokasi, Section, Model, Pengguna, Status
// Kolom opsional: Kapasitas, Warna, Tgl Datang (YYYY-MM-DD / DD/MM/YYYY), Vendor, Harga, WiFi, IP, User iReporter, iOS
// Credential TIDAK diimpor dari CSV – isi ulang lewat aplikasi (passcode lemah/duplikat langsung ketahuan).
import 'dotenv/config';
import fs from 'node:fs';
import { makePool } from '../src/db.js';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Pemakaian: node scripts/import-devices-csv.js data.csv [--commit]'); process.exit(1); }
const commit = flag === '--commit';

function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const norm = (s) => String(s || '').trim();
const serialN = (s) => norm(s).toUpperCase().replace(/Ø/g, '0').replace(/\s+/g, '');
const capN = (s) => { const m = norm(s).toUpperCase().replace(/\s/g, '').match(/(\d+)GB/); return m ? `${m[1]}GB` : norm(s) || null; };
function dateN(s) {
  s = norm(s); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10); // serial date Excel
  return 'INVALID';
}
const STAT = { available: 'Available', damaged: 'Damaged', loss: 'Loss', repair: 'Repair', retired: 'Retired' };

const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''));
const head = rows.shift().map((h) => h.trim().toLowerCase());
const col = (r, ...names) => { for (const n of names) { const i = head.indexOf(n.toLowerCase()); if (i >= 0) return norm(r[i]); } return ''; };

const pool = makePool(process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL);
const c = await pool.connect();
const errors = []; const warn = []; let ok = 0;
try {
  await c.query('BEGIN');
  const secs = (await c.query('SELECT s.id, s.name, l.name lokasi FROM section s JOIN lokasi l ON l.id=s.lokasi_id')).rows;
  const seen = new Set();
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const serial = serialN(col(r, 'serial', 'serial number'));
    const sec = secs.find((s) => s.lokasi.toLowerCase() === col(r, 'lokasi').toLowerCase() && s.name.toLowerCase() === col(r, 'section', 'sub lokasi').toLowerCase());
    const status = STAT[col(r, 'status').toLowerCase()] || 'Available';
    const arrival = dateN(col(r, 'tgl datang', 'tanggal datang', 'arrival'));
    if (!/^[A-Z0-9]{8,14}$/.test(serial)) { errors.push(`baris ${line}: serial "${serial}" tidak valid`); continue; }
    if (seen.has(serial)) { errors.push(`baris ${line}: serial ${serial} dobel di file`); continue; }
    seen.add(serial);
    if (!sec) { errors.push(`baris ${line}: lokasi/section "${col(r, 'lokasi')} · ${col(r, 'section', 'sub lokasi')}" belum ada di master`); continue; }
    if (arrival === 'INVALID') { errors.push(`baris ${line}: tanggal "${col(r, 'tgl datang', 'tanggal datang')}" tidak dikenali`); continue; }
    const ip = col(r, 'ip', 'ip address');
    await c.query('SAVEPOINT r');
    try {
      const ins = await c.query(`INSERT INTO device(serial,name,section_id,model,capacity,color,user_name,arrival,vendor,price,status,wifi,ip,ireporter_user,ios,apple_status,last_check)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Need Verification',NULL)
        ON CONFLICT (serial) DO NOTHING RETURNING id`,
      [serial, col(r, 'nama', 'nama ipad') || null, sec.id, col(r, 'model') || 'Tidak diketahui', capN(col(r, 'kapasitas', 'capacity')), col(r, 'warna', 'color') || null,
        col(r, 'pengguna', 'pic') || '-', arrival, col(r, 'vendor', 'dibeli dari') || null, Number(col(r, 'harga').replace(/[^\d]/g, '')) || null, status,
        col(r, 'wifi', 'wi-fi') || null, /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null, col(r, 'user ireporter', 'user i-reporter') || null, col(r, 'ios') || null]);
      if (!ins.rowCount) { warn.push(`baris ${line}: ${serial} sudah ada di database – dilewati`); await c.query('RELEASE SAVEPOINT r'); continue; }
      await c.query("INSERT INTO device_history(device_id,by_name,action) VALUES($1,'Migrasi Excel','Import dari iPad List.xlsx')", [ins.rows[0].id]);
      await c.query('RELEASE SAVEPOINT r');
      ok++;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT r');
      errors.push(`baris ${line}: ${e.message}`);
    }
  }
  const dupNames = await c.query("SELECT name, count(*) n FROM device WHERE name IS NOT NULL AND status IN ('Available','Repair') GROUP BY name HAVING count(*)>1");
  for (const d of dupNames.rows) warn.push(`nama ${d.name} dipakai ${d.n} iPad aktif – perbaiki setelah import`);
  await c.query(commit ? 'COMMIT' : 'ROLLBACK');
} finally { c.release(); await pool.end(); }
console.log(`${commit ? 'DISIMPAN' : 'DRY-RUN (tidak disimpan)'}: ${ok} iPad siap, ${errors.length} error, ${warn.length} peringatan`);
errors.forEach((e) => console.log('  ✗ ' + e));
warn.forEach((w) => console.log('  ! ' + w));
if (!commit) console.log('Tambahkan --commit untuk menyimpan.');
