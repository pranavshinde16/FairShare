// The pre-deploy step in the Docker image: `node dist/migrate.js`. Applies pending migrations and
// the reference data, runs the data repairs, then exits. Locally, use `pnpm db:migrate` instead.
import { createDb, runMigrations } from '@fairshare/db';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadDatabaseEnv } from './config/env';
import { repairClaimedSplitInputs } from './modules/claims/repair';

// The image copies packages/db/migrations next to dist/ (see the Dockerfile).
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

try {
  // Only the database settings: the migration doesn't need the server's secrets.
  const env = loadDatabaseEnv();
  const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
  await runMigrations(url, MIGRATIONS_FOLDER);
  console.log('Migrations and reference data are up to date.');
  // Data repairs that need core (migrations are SQL only). Idempotent; a count, never IDs.
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const { repaired } = await repairClaimedSplitInputs(createDb(pool));
    console.log(`Split inputs naming a claimed placeholder: ${repaired} repaired.`);
  } finally {
    await pool.end();
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
