// `pnpm --filter @fairshare/api repair:split-inputs`: runs the split-input repair on its own (the
// pre-deploy step runs it after the migrations; see migrate.ts). Prints a count, never IDs.
import { createDb } from '@fairshare/db';
import pg from 'pg';
import { loadDatabaseEnv } from './config/env';
import { repairClaimedSplitInputs } from './modules/claims/repair';

const env = loadDatabaseEnv();
const pool = new pg.Pool({
  connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
  max: 1,
});
try {
  const { repaired } = await repairClaimedSplitInputs(createDb(pool));
  console.log(`Split inputs naming a claimed placeholder: ${repaired} repaired.`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
