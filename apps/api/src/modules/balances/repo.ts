import {
  activityLog,
  groupMembers,
  groups,
  ledger,
  transactionPayers,
  transactions,
  transactionShares,
  type Db,
  type Tx,
} from '@fairshare/db';
import { aliasedTable, and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

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

/**
 * What one person paid and owed in a group, per currency and transaction type: their nets, and
 * the explanation of them.
 */
export type LedgerTotals = {
  userId: string;
  currency: string;
  type: 'expense' | 'settlement';
  paid: number;
  owed: number;
};

/**
 * The group's payer and share rows summed per person, currency and type, in one read. This is the
 * ledger view's definition (live transactions only) with the type added, read from the tables
 * directly: joining the view back to transactions for the type made GET /balances a third slower
 * at 5,000 expenses. The friend-consistency test checks it against the view.
 */
export async function ledgerTotals(db: Handle, groupId: string): Promise<LedgerTotals[]> {
  const side = (lines: typeof transactionPayers | typeof transactionShares) => {
    const sum = sql<string>`sum(${lines.amount})`;
    const zero = sql<string>`0`;
    return db
      .select({
        userId: lines.userId,
        currency: transactions.currency,
        type: transactions.type,
        paid: lines === transactionPayers ? sum : zero,
        owed: lines === transactionPayers ? zero : sum,
      })
      .from(transactions)
      .innerJoin(lines, eq(lines.transactionId, transactions.id))
      .where(and(eq(transactions.groupId, groupId), isNull(transactions.deletedAt)))
      .groupBy(lines.userId, transactions.currency, transactions.type);
  };
  const rows = await unionAll(side(transactionPayers), side(transactionShares));
  // sum() over bigint is numeric, which node-postgres returns as a string.
  return rows.map((row) => ({ ...row, paid: Number(row.paid), owed: Number(row.owed) }));
}

/** When each group last changed: the time of its newest activity entry. */
export async function lastActivity(db: Handle, groupIds: string[]): Promise<Map<string, Date>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([activityLog.groupId], {
      groupId: activityLog.groupId,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(inArray(activityLog.groupId, groupIds))
    .orderBy(activityLog.groupId, desc(activityLog.id));
  return new Map(rows.map((row) => [row.groupId, row.createdAt]));
}

/** The groups (either kind) where both of us are active members, and that aren't deleted. */
export async function sharedGroups(db: Handle, me: string, other: string) {
  const mine = aliasedTable(groupMembers, 'mine');
  const theirs = aliasedTable(groupMembers, 'theirs');
  return db
    .select({
      id: groups.id,
      kind: groups.kind,
      name: groups.name,
      currency: groups.currency,
    })
    .from(mine)
    .innerJoin(theirs, eq(theirs.groupId, mine.groupId))
    .innerJoin(groups, eq(groups.id, mine.groupId))
    .where(
      and(
        eq(mine.userId, me),
        isNull(mine.leftAt),
        eq(theirs.userId, other),
        isNull(theirs.leftAt),
        isNull(groups.deletedAt),
      ),
    );
}
