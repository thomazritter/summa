import { Pool, PoolClient, QueryResult } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

/** Run a parameterized query and return the full result. */
export async function query(text: string, params?: unknown[]): Promise<QueryResult> {
  return pool.query(text, params);
}

/** Run a query and return the first row, or null. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await pool.query(text, params);
  return (result.rows[0] as T) ?? null;
}

/** Run a query and return all rows. */
export async function queryAll<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Run a write query (INSERT/UPDATE/DELETE) and return affected count + inserted id. */
export async function execute(
  text: string,
  params?: unknown[],
): Promise<{ changes: number; lastId: unknown }> {
  const result = await pool.query(text, params);
  return { changes: result.rowCount ?? 0, lastId: result.rows[0]?.id };
}

/** Acquire a client from the pool (for transactions). */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/** Close the pool (for graceful shutdown). */
export async function closeDb(): Promise<void> {
  await pool.end();
}

export { pool };
