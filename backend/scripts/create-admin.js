// Daftarkan IT Admin pertama: node scripts/create-admin.js nama@hirose.co.id "Nama Lengkap"
// Saat orang ini login pertama kali dengan akun Microsoft, akunnya otomatis terhubung.
import 'dotenv/config';
import { makePool } from '../src/db.js';

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('Pemakaian: node scripts/create-admin.js nama@hirose.co.id "Nama Lengkap"');
  process.exit(1);
}
const pool = makePool();
const r = await pool.query(
  `INSERT INTO app_user(email,name,role) VALUES($1,$2,'admin')
   ON CONFLICT (email) DO UPDATE SET role='admin', active=true RETURNING id`, [email.toLowerCase(), name]);
console.log(`✓ ${email} terdaftar sebagai IT Admin (id ${r.rows[0].id})`);
await pool.end();
