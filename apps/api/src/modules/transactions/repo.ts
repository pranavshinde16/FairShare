// Drizzle queries for transactions, their payer and share lines, and their history. Reads of group
// data always take the group ID; single-transaction reads are checked against membership by the
// service before anything is returned.

import {
  activityLog,
  groupMembers,
  groups,
  transactionPayers,
  transactions,
  transactionShares,
  users,
  type Db,
  type Tx,
} from '@fairshare/db';
import { and, asc, desc, eq, exists, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

type Handle = Db | Tx;
type Line = { userId: string; amount: number };

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type TransactionLines = { payers: Line[]; shares: Line[] };

export async function findTransaction(db: Handle, id: string): Promise<TransactionRow | undefined> {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

/**
 * Locks a transaction for an edit, delete or restore. NO KEY UPDATE: concurrent writers of this row
 * queue, while inserts that merely reference it are not blocked.
 */
export async function lockTransaction(tx: Tx, id: string): Promise<TransactionRow | undefined> {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .for('no key update');
  return row;
}

/** Payer and share lines for several transactions, each list sorted by user ID. */
export async function linesFor(db: Handle, ids: string[]): Promise<Map<string, TransactionLines>> {
  const result = new Map<string, TransactionLines>(
    ids.map((id) => [id, { payers: [], shares: [] }]),
  );
  if (ids.length === 0) return result;
  const select = (table: typeof transactionPayers | typeof transactionShares) =>
    db
      .select({ transactionId: table.transactionId, userId: table.userId, amount: table.amount })
      .from(table)
      .where(inArray(table.transactionId, ids))
      .orderBy(asc(table.transactionId), asc(table.userId));
  const [payers, shares] = await Promise.all([
    select(transactionPayers),
    select(transactionShares),
  ]);
  for (const p of payers)
    result.get(p.transactionId)!.payers.push({ userId: p.userId, amount: p.amount });
  for (const s of shares)
    result.get(s.transactionId)!.shares.push({ userId: s.userId, amount: s.amount });
  return result;
}

export async function insertTransaction(
  tx: Tx,
  row: NewTransactionRow,
  lines: TransactionLines,
): Promise<void> {
  await tx.insert(transactions).values(row);
  await insertLines(tx, row.id, lines);
}

/** An edit replaces every payer and share row; the deferred triggers re-check the sums at COMMIT. */
export async function replaceLines(tx: Tx, id: string, lines: TransactionLines): Promise<void> {
  await tx.delete(transactionPayers).where(eq(transactionPayers.transactionId, id));
  await tx.delete(transactionShares).where(eq(transactionShares.transactionId, id));
  await insertLines(tx, id, lines);
}

async function insertLines(tx: Tx, id: string, { payers, shares }: TransactionLines) {
  await tx.insert(transactionPayers).values(payers.map((l) => ({ transactionId: id, ...l })));
  await tx.insert(transactionShares).values(shares.map((l) => ({ transactionId: id, ...l })));
}

type Columns = Pick<
  NewTransactionRow,
  'description' | 'notes' | 'currency' | 'amount' | 'occurredOn' | 'splitMethod' | 'splitInput'
>;

/** An edit: the new columns, the next version, and who changed it when. */
export async function saveEdit(
  tx: Tx,
  id: string,
  columns: Columns,
  nextVersion: number,
  by: string,
): Promise<void> {
  await tx
    .update(transactions)
    .set({ ...columns, version: nextVersion, updatedBy: by, updatedAt: sql`now()` })
    .where(eq(transactions.id, id));
}

export async function softDelete(tx: Tx, id: string, nextVersion: number, by: string) {
  const [row] = await tx
    .update(transactions)
    .set({ deletedAt: sql`now()`, deletedBy: by, version: nextVersion })
    .where(eq(transactions.id, id))
    .returning({
      id: transactions.id,
      version: transactions.version,
      deletedAt: transactions.deletedAt,
    });
  return row!;
}

export async function undelete(tx: Tx, id: string, nextVersion: number): Promise<void> {
  await tx
    .update(transactions)
    .set({ deletedAt: null, deletedBy: null, version: nextVersion })
    .where(eq(transactions.id, id));
}

/** Everyone who has ever been in the group, with whether they still are. */
export async function memberStates(db: Handle, groupId: string): Promise<Map<string, boolean>> {
  const rows = await db
    .select({ userId: groupMembers.userId, leftAt: groupMembers.leftAt })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return new Map(rows.map((r) => [r.userId, r.leftAt === null]));
}

/** Holds the group still while a transaction is written, so nobody joins or leaves meanwhile. */
export async function shareLockGroup(tx: Tx, groupId: string) {
  const [row] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('share');
  return row;
}

export type ListFilters = {
  /** The last row of the previous page: [occurredOn, id]. */
  after?: [string, string];
  limit: number;
  q?: string;
  person?: string;
  type?: 'expense' | 'settlement';
  from?: string;
  to?: string;
  includeDeleted: boolean;
};

/**
 * A page of a group's transactions, newest first: ORDER BY occurred_on DESC, id DESC, which the
 * tx_group_feed and tx_group_all indexes serve. The keyset condition (occurred_on, id) < cursor is
 * stable while new rows are inserted. Fetches one row more than the limit to know if there's more.
 */
export async function listTransactions(
  db: Handle,
  groupId: string,
  filters: ListFilters,
): Promise<TransactionRow[]> {
  const conditions = [eq(transactions.groupId, groupId)];
  if (!filters.includeDeleted) conditions.push(isNull(transactions.deletedAt));
  if (filters.after) {
    const [date, id] = filters.after;
    conditions.push(
      or(
        lt(transactions.occurredOn, date),
        and(eq(transactions.occurredOn, date), lt(transactions.id, id)),
      )!,
    );
  }
  if (filters.type) conditions.push(eq(transactions.type, filters.type));
  if (filters.from) conditions.push(gte(transactions.occurredOn, filters.from));
  if (filters.to) conditions.push(lte(transactions.occurredOn, filters.to));
  if (filters.q) {
    // The same expression as the tx_search trigram index, so the index can serve ILIKE.
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      sql`(${transactions.description} || ' ' || coalesce(${transactions.notes}, '')) ILIKE ${pattern}`,
    );
  }
  if (filters.person) {
    const person = filters.person;
    const involved = (table: typeof transactionPayers | typeof transactionShares) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(table)
          .where(and(eq(table.transactionId, transactions.id), eq(table.userId, person))),
      );
    conditions.push(or(involved(transactionPayers), involved(transactionShares))!);
  }
  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(filters.limit + 1);
}

export type PersonRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  isPlaceholder: boolean;
  mergedInto: string | null;
};

/** People by ID, with a claimed placeholder's ID also mapped to whoever claimed it. */
export async function people(db: Handle, ids: string[]): Promise<Map<string, PersonRow>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const columns = {
    id: users.id,
    name: users.name,
    avatarUrl: users.avatarUrl,
    isPlaceholder: users.isPlaceholder,
    mergedInto: users.mergedInto,
  };
  const rows = await db.select(columns).from(users).where(inArray(users.id, unique));
  const merged = rows.flatMap((r) => (r.mergedInto ? [r.mergedInto] : []));
  const claimers = merged.length
    ? await db.select(columns).from(users).where(inArray(users.id, merged))
    : [];
  const byId = new Map(claimers.map((r) => [r.id, r]));
  // Old activity names the placeholder; show the person who claimed it (plan correction).
  return new Map(rows.map((r) => [r.id, (r.mergedInto && byId.get(r.mergedInto)) || r]));
}

/** A transaction's history, oldest first. */
export async function historyOf(db: Handle, transactionId: string) {
  return db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, 'transaction'), eq(activityLog.entityId, transactionId)))
    .orderBy(asc(activityLog.id));
}
