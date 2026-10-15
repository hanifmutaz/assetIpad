// Jalankan migrasi SQL berurutan. Pakai DATABASE_URL_MIGRATE (owner skema) bila ada.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePool } from '../src/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const pool = makePool(process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL);

const c = await pool.connect();
try {
  const v = await c.query('SHOW server_version_num');
  if (Number(v.rows[0].server_version_num) < 130000) {
    console.error('PostgreSQL minimal versi 13 diperlukan (versi 9.x sudah end-of-life dan tidak mendapat patch keamanan).');
    process.exit(1);
  }
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await c.query('SELECT pg_advisory_lock(727001)');
  const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    process.stdout.write(`→ ${f} … `);
    await c.query('BEGIN');
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]);
      await c.query('COMMIT');
      console.log('OK');
    } catch (e) {
      await c.query('ROLLBACK');
      console.log('GAGAL');
      throw e;
    }
  }
  console.log('Migrasi selesai.');
} finally {
  await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
  c.release();
  await pool.end();
}
