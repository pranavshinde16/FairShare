// The migration set itself: what it creates, and that it can be re-run safely.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import { CURRENCIES } from './reference';
import { currencies } from './schema';
import { createTestDatabase, type TestDatabase } from './testing';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

const names = async (query: string) =>
  (await t.pool.query<{ name: string }>(query)).rows.map((r) => r.name);

describe('migrations', () => {
  it('create every MVP table and the ledger view', async () => {
    expect(
      await names(`SELECT table_name AS name FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`),
    ).toEqual([
      'activity_log',
      'ai_requests',
      'auth_account',
      'auth_session',
      'auth_user',
      'auth_verification',
      'currencies',
      'direct_pairs',
      'group_members',
      'groups',
      'invites',
      'transaction_payers',
      'transaction_shares',
      'transactions',
      'users',
    ]);
    expect(
      await names(
        `SELECT table_name AS name FROM information_schema.views WHERE table_schema = 'public'`,
      ),
    ).toEqual(['ledger']);
  });

  it('install citext and pg_trgm', async () => {
    expect(
      await names(`SELECT extname AS name FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`),
    ).toEqual(['citext', 'pg_trgm']);
  });

  it('install the deferred ledger triggers and the append-only triggers', async () => {
    const { rows } = await t.pool.query<{ name: string; deferred: boolean }>(
      `SELECT tgname AS name, tginitdeferred AS deferred FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`,
    );
    expect(rows).toEqual([
      { name: 'activity_log_append_only', deferred: false },
      { name: 'activity_log_no_truncate', deferred: false },
      { name: 'transaction_payers_balanced', deferred: true },
      { name: 'transaction_shares_balanced', deferred: true },
      { name: 'transactions_balanced', deferred: true },
    ]);
  });

  it('record all four migrations, and re-running them is a no-op', async () => {
    const count = async () =>
      (
        await t.pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0]!.n;
    expect(await count()).toBe(4);
    await runMigrations(t.url);
    expect(await count()).toBe(4);
  });
});

describe('reference data', () => {
  it('loads every currency, once', async () => {
    const rows = await t.db.select().from(currencies);
    expect(rows).toHaveLength(CURRENCIES.length);
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
  });

  it('agrees with Intl on each currency’s decimal places', () => {
    for (const { code, minorUnits } of CURRENCIES) {
      const digits = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      expect({ code, minorUnits }).toEqual({ code, minorUnits: digits });
    }
  });

  it('updates a changed currency on the next run instead of duplicating it', async () => {
    await t.db.execute(sql`UPDATE currencies SET symbol = 'old' WHERE code = 'INR'`);
    await runMigrations(t.url);
    const { rows } = await t.pool.query<{ symbol: string }>(
      `SELECT symbol FROM currencies WHERE code = 'INR'`,
    );
    expect(rows).toEqual([{ symbol: '₹' }]);
  });
});
