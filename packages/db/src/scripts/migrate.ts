// pnpm --filter @fairshare/db migrate: applies migrations and reference data to DATABASE_URL.
import { runMigrations } from '../migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env for local development.');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations and reference data are up to date.');
