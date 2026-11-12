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

/** Cheap round-trip used by the health check. Never throws; logs why the database is down. */
export async function pingDatabase(
  pool: pg.Pool,
  log: Pick<Logger, 'warn'>,
): Promise<'up' | 'down'> {
  try {
    await pool.query('SELECT 1');
    return 'up';
  } catch (err) {
    log.warn({ dbError: describeDbError(err) }, 'database health check failed');
    return 'down';
  }
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/gi;

/**
 * The code and message of a connection failure, e.g. `28P01` "password authentication failed for
 * user ...", or `ENOTFOUND`. Only those two fields: the error object itself can carry more than
 * we want in a log (Node's `ERR_INVALID_URL` keeps the whole input URL, password included), and
 * any connection string in the message is cut out.
 */
export function describeDbError(err: unknown): { code?: string; message: string } {
  if (!(err instanceof Error)) return { message: 'non-error thrown' };
  const { code } = err as { code?: unknown };
  // Node reports a refused connection to every address of a host as an AggregateError with an
  // empty message; the reasons are in its errors.
  const message =
    err.message ||
    (err instanceof AggregateError ? err.errors.map((e) => String(e)).join('; ') : err.name);
  return {
    ...(typeof code === 'string' && { code }),
    message: message.replace(CONNECTION_STRING, '[connection string]'),
  };
}
