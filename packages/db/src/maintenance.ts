// Data that the app promises to forget: run nightly (.github/workflows/nightly.yml, "Maintenance")
// with a login role in fairshare_app, which may update these rows.

import { sql } from 'drizzle-orm';
import type { Db } from './client';

/** How long a sentence sent to an AI provider is kept (Blueprint 8.9, the privacy notice). */
export const AI_INPUT_RETENTION_DAYS = 30;

export type MaintenanceReport = { aiInputsPurged: number };

/** Forgets typed sentences older than the retention period. Idempotent; returns counts only. */
export async function runMaintenance(db: Db): Promise<MaintenanceReport> {
  const purged = await db.execute(sql`
    UPDATE ai_requests SET input_text = NULL
    WHERE input_text IS NOT NULL
      AND created_at < now() - make_interval(days => ${AI_INPUT_RETENTION_DAYS})`);
  return { aiInputsPurged: purged.rowCount ?? 0 };
}
