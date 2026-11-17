// pnpm --filter @fairshare/db maintenance: the nightly maintenance (src/maintenance.ts).
//
// Connects to DATABASE_URL, which in production is a login role in fairshare_app. Prints counts
// only: the nightly job's logs are public. Exit codes: 0 done, 2 it couldn't run.

import pg from 'pg';
import { createDb } from '../client';
import { runMaintenance } from '../maintenance';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const report = await runMaintenance(createDb(pool));
  console.log(JSON.stringify({ ranAt: new Date().toISOString(), ...report }));
} catch (err) {
  // The message only: a connection error can include the host, never the password.
  console.error(`Maintenance couldn't run: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
} finally {
  await pool.end();
}
