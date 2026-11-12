import { ledger, type Db, type Tx } from '@fairshare/db';
import { inArray, sql } from 'drizzle-orm';

type Handle = Db | Tx;

/** One person's net in one group and currency: + they are owed, − they owe. Never zero. */
export type NetRow = { groupId: string; userId: string; currency: string; net: number };

/** Every non-zero member net in the given groups, from the ledger view (deleted transactions excluded). */
export async function netsForGroups(db: Handle, groupIds: string[]): Promise<NetRow[]> {
  if (groupIds.length === 0) return [];
  const total = sql<string>`sum(${ledger.amount})`;
  const rows = await db
    .select({
      groupId: ledger.groupId,
      userId: ledger.userId,
      currency: ledger.currency,
      net: total,
    })
    .from(ledger)
    .where(inArray(ledger.groupId, groupIds))
    .groupBy(ledger.groupId, ledger.userId, ledger.currency)
    .having(sql`${total} <> 0`);
  // sum() over bigint is numeric, which node-postgres returns as a string.
  return rows.map((row) => ({ ...row, net: Number(row.net) }));
}
