// Repairs expenses claimed before the claim rewrote split inputs (docs/dev-log/
// fix-claim-split-input.md): their split_input still names the placeholder. Run by the pre-deploy
// step after the migrations, and by `pnpm --filter @fairshare/api repair:split-inputs`.

import { users, withTx, type Db } from '@fairshare/db';
import { isNotNull, sql } from 'drizzle-orm';
import { rewriteSplitInputs } from './merge';

/**
 * Renames every claimed placeholder still named in a split input (deleted transactions included)
 * to whoever claimed it, exactly as a claim does now. Idempotent: it only touches rows that still
 * name a claimed placeholder, so every run after the first repairs nothing.
 */
export async function repairClaimedSplitInputs(db: Db): Promise<{ repaired: number }> {
  return withTx(db, async (tx) => {
    // The claimed placeholders that some split input still names: one pass over the inputs.
    const named = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT u.id
      FROM transactions t
      CROSS JOIN LATERAL jsonb_path_query(t.split_input, 'strict $.** ? (@.type() == "string")') v
      JOIN users u ON u.id::text = v #>> '{}' AND u.merged_into IS NOT NULL
      ORDER BY u.id`);
    if (named.rows.length === 0) return { repaired: 0 };

    const mergedInto = new Map(
      (
        await tx
          .select({ id: users.id, mergedInto: users.mergedInto })
          .from(users)
          .where(isNotNull(users.mergedInto))
      ).map((u) => [u.id, u.mergedInto!]),
    );
    let repaired = 0;
    for (const { id } of named.rows) {
      repaired += await rewriteSplitInputs(tx, id, claimerOf(id, mergedInto));
    }
    return { repaired };
  });
}

/** Whoever finally holds a placeholder's identity. Claimers are accounts, never merged themselves, so this is one step; the loop is a guard. */
function claimerOf(id: string, mergedInto: ReadonlyMap<string, string>): string {
  let current = id;
  for (let steps = 0; mergedInto.has(current); steps++) {
    if (steps === mergedInto.size) throw new Error(`merged_into loops back on itself at ${id}`);
    current = mergedInto.get(current)!;
  }
  return current;
}
