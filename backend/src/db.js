import 'dotenv/config';
import pg from 'pg';

// DATE -> 'YYYY-MM-DD' (hindari geser zona waktu), NUMERIC & BIGINT -> number
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export function makePool(url = process.env.DATABASE_URL) {
  return new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    application_name: 'ipad-asset',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  });
}

export const pool = makePool();
export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
