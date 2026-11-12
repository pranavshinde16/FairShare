// The pre-deploy step in the Docker image: `node dist/migrate.js`. Applies pending migrations and
// the reference data, then exits. Locally, use `pnpm db:migrate` instead.
import { runMigrations } from '@fairshare/db';
import { fileURLToPath } from 'node:url';
import { loadDatabaseEnv } from './config/env';

// The image copies packages/db/migrations next to dist/ (see the Dockerfile).
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

try {
  // Only the database settings: the migration doesn't need the server's secrets.
  const env = loadDatabaseEnv();
  await runMigrations(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, MIGRATIONS_FOLDER);
  console.log('Migrations and reference data are up to date.');
} catch (err) {
  console.error(err);
  process.exit(1);
}
