import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** A handle inside a database transaction. Every repo function that writes takes one of these. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(pool: Pool): Db {
  return drizzle({ client: pool, schema });
}

/**
 * Runs `fn` in one database transaction: everything commits together or nothing does. Every write
 * that touches money goes through here, with its activity entry in the same transaction.
 *
 * Isolation is Postgres's default (READ COMMITTED); callers lock the row they edit with
 * SELECT … FOR UPDATE. The ledger triggers are deferred, so a broken sum surfaces at COMMIT as an
 * error from this call (see isLedgerInvariantError).
 */
export function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Names of the commit-time checks in migration 0002. */
export const LEDGER_CONSTRAINTS = ['transaction_sums', 'settlement_shape'] as const;

/**
 * True when an error is the ledger trigger rejecting a transaction. That's always a bug (core
 * should have caught it first), so the API reports it as an invariant violation, not a 4xx.
 */
export function isLedgerInvariantError(error: unknown): boolean {
  const pgError = findPgError(error);
  return (
    pgError?.code === '23514' &&
    (LEDGER_CONSTRAINTS as readonly string[]).includes(pgError.constraint ?? '')
  );
}

type PgErrorFields = { code?: string; constraint?: string };

/** Drizzle wraps driver errors (DrizzleQueryError), so look through the cause chain. */
export function findPgError(error: unknown): PgErrorFields | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      return current as PgErrorFields;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
