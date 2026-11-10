import pg from 'pg';
import type { Logger } from 'pino';

export function createPool(connectionString: string, log: Pick<Logger, 'warn'>): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
  // When Postgres restarts or fails over, it drops idle connections and the pool emits
  // 'error'. Without a listener Node treats that as fatal and the whole API crashes.
  // The pool discards the broken client and the next query opens a fresh connection.
  pool.on('error', (err) => {
    log.warn({ err }, 'idle database connection lost');
  });
  return pool;
}

/** Cheap round-trip used by the health check. Never throws. */
export async function pingDatabase(pool: pg.Pool): Promise<'up' | 'down'> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}
