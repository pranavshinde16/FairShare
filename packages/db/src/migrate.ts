import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDb } from './client';
import { applyReferenceData } from './reference';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies pending migrations, then the reference data (currencies). Run with the owner role, as
 * the pre-deploy step. Already-applied migrations are skipped, so running it twice is harmless.
 * A bundled caller (the API's image) passes the folder, since its own location differs.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const db = createDb(pool);
    await migrate(db, { migrationsFolder });
    await applyReferenceData(db);
  } finally {
    await pool.end();
  }
}
