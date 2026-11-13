// pnpm --filter @fairshare/db check-invariants: the nightly invariant check (Blueprint 9.2).
//
// Connects to DATABASE_URL, which in production is a login role in fairshare_readonly (it can't
// write; the checks also run in a read-only transaction). Prints how many of each finding there
// are, never what they are: the nightly job's logs are public. Exit codes: 0 clean, 1 findings,
// 2 the check couldn't run. Run it yourself with --details to see the IDs involved.

import pg from 'pg';
import { createDb } from '../client';
import { checkInvariants, isClean, summarize } from '../invariants';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const report = await checkInvariants(createDb(pool));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...summarize(report) }));
  if (process.argv.includes('--details')) console.log(JSON.stringify(report, null, 2));
  if (!isClean(report)) {
    console.error('Invariant violations found. Run with --details to see them.');
    process.exitCode = 1;
  }
} catch (err) {
  // The message only: a connection error can include the host, never the password.
  console.error(`The check couldn't run: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
} finally {
  await pool.end();
}
