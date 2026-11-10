import { defineConfig } from 'drizzle-kit';

// `pnpm generate` diffs src/schema against the last snapshot and writes a new SQL migration.
// Migrations are committed and reviewed; `drizzle-kit push` is never used.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
});
