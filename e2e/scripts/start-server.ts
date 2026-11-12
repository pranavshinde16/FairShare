// Starts the production build for the end-to-end tests: a fresh, migrated `fairshare_e2e`
// database, then the API serving the built web app, in production mode, sending email to Mailpit.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = process.env.E2E_PORT ?? '3100';
// The same server the integration tests use (docker-compose.yml locally, a service in CI).
const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://fairshare:fairshare@localhost:5433/fairshare_test';
const DATABASE = 'fairshare_e2e';
const databaseUrl = Object.assign(new URL(ADMIN_URL), { pathname: `/${DATABASE}` }).toString();

const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DATABASE}`);
await admin.end();

const migrated = spawnSync('pnpm', ['--filter', '@fairshare/db', 'migrate'], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});
if (migrated.status !== 0) process.exit(migrated.status ?? 1);

const server = spawn('node', ['--enable-source-maps', 'apps/api/dist/main.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT,
    DATABASE_URL: databaseUrl,
    APP_URL: `http://localhost:${PORT}`,
    AUTH_SECRET: 'e2e-only-secret-not-used-anywhere-else',
    MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:8025',
    WEB_DIST_DIR: 'apps/web/dist',
    LOG_LEVEL: 'warn',
    // Each test sends its own X-Real-IP, so Better Auth's per-IP limits don't pool all tests.
    CLIENT_IP_HEADERS: 'x-real-ip',
  },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
