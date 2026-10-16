// Buat Super Admin pertama: npm run create-superadmin -- nama@hirose.co.id "Nama Lengkap"
import 'dotenv/config';
import crypto from 'node:crypto';
import { makePool } from '../src/db.js';
import { hashPassword } from '../src/crypto.js';

const [email, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
  console.error('Pemakaian: npm run create-superadmin -- nama@hirose.co.id "Nama Lengkap"');
  process.exit(1);
}
const pw = crypto.randomBytes(9).toString('base64url');
const pool = makePool(process.env.DATABASE_URL);
await pool.query(
  `INSERT INTO app_user(email,name,role,pw_hash,must_change_pw) VALUES($1,$2,'superadmin',$3,true)
   ON CONFLICT (email) DO UPDATE SET role='superadmin', active=true, pw_hash=EXCLUDED.pw_hash, must_change_pw=true, failed_count=0, locked_until=NULL`,
  [email.toLowerCase(), name, await hashPassword(pw)]);
console.log(`✓ ${email} = Super Admin\n  Password sementara: ${pw}\n  (wajib diganti saat login pertama; tidak disimpan di mana pun)`);
await pool.end();
