import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __ipromo_pg_pool__: Pool | undefined;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}

function getPool(): Pool {
  if (globalThis.__ipromo_pg_pool__) return globalThis.__ipromo_pg_pool__;

  const connectionString = requiredEnv("DATABASE_URL");
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  globalThis.__ipromo_pg_pool__ = pool;
  return pool;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query<T>(text, params ? [...params] : undefined);
  return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
}

export async function dbWithClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

