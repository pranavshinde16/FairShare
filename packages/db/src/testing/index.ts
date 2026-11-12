// Integration-test harness: a fresh, fully migrated database for each test file.
//
// globalSetup migrates a template database once per run (setupTemplateDatabase). Each test file
// then clones it with CREATE DATABASE … TEMPLATE, which takes milliseconds, so files can run in
// parallel without sharing state.

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type Db } from '../client';
import { runMigrations } from '../migrate';

/** Where tests connect. Matches docker-compose.yml locally; CI sets TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://fairshare:fairshare@localhost:5433/fairshare_test';

/**
 * The migrated database every test database is cloned from. Packages whose tests run in parallel
 * (turbo runs each package's tests at once) each name their own in vitest.config.ts, so one
 * package's setup never drops the template another is cloning from.
 */
const TEMPLATE = process.env.TEST_TEMPLATE_DATABASE ?? 'fairshare_test_template';
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(TEMPLATE)) {
  throw new Error(`TEST_TEMPLATE_DATABASE must be a plain database name, got "${TEMPLATE}"`);
}

/** The same server and credentials, a different database. */
export function databaseUrl(name: string, base = TEST_DATABASE_URL): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (cause) {
    throw new Error(
      `Can't reach the test database at ${new URL(TEST_DATABASE_URL).host}. Start it with \`pnpm db:up\`.`,
      { cause },
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Vitest globalSetup: rebuilds the migrated template database. */
export async function setupTemplateDatabase(): Promise<void> {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEMPLATE}`);
  });
  await runMigrations(databaseUrl(TEMPLATE));
}

export type TestDatabase = {
  name: string;
  url: string;
  pool: pg.Pool;
  db: Db;
  /** Closes the pool and drops the database. */
  drop: () => Promise<void>;
};

/** A new database cloned from the migrated template. Call drop() in afterAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `fairshare_test_${randomBytes(6).toString('hex')}`;
  await withAdmin((admin) => admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`));
  const url = databaseUrl(name);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    name,
    url,
    pool,
    db: createDb(pool),
    drop: async () => {
      await pool.end();
      await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}

export * from './factories';
export { SEED_ACCOUNTS, SEED_IDS, seedDemo } from '../seed';
