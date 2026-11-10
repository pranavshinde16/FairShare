// pnpm --filter @fairshare/db seed: adds the demo Goa group to DATABASE_URL (development only).
import pg from 'pg';
import { createDb } from '../client';
import { seedDemo, SEED_ACCOUNTS } from '../seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env for local development.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const result = await seedDemo(createDb(pool));
  console.log(
    result === 'seeded'
      ? `Seeded the Goa Trip group. Demo accounts: ${SEED_ACCOUNTS.map((a) => a.email).join(', ')}.`
      : 'Demo data is already present; nothing changed.',
  );
} finally {
  await pool.end();
}
