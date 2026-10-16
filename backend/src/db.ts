import 'dotenv/config';
import pg from 'pg';

pg.types.setTypeParser(1082, (v: string) => v); // DATE tetap 'YYYY-MM-DD'
pg.types.setTypeParser(1700, (v: string) => Number(v));
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Db = Pick<pg.PoolClient, 'query'>;

export function makePool(url = process.env.DATABASE_URL): pg.Pool {
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
// Semua tanggal bisnis memakai zona Asia/Jakarta
pool.on('connect', (c) => { void c.query("SET TIME ZONE 'Asia/Jakarta'"); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function one<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<T | null> {
  return (await pool.query<T>(text, params as unknown[])).rows[0] ?? null;
}
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
