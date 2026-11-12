import {
  latestOccurredOn,
  type ActivityEntry,
  type CreateExpense,
  type DeletedTransaction,
  type Transaction,
  type TransactionHistory,
  type TransactionListQuery,
  type TransactionPage,
  type UpdateExpense,
  type UserRef,
} from '@fairshare/contracts';
import {
  assertTransactionInvariants,
  canonicalSnapshot,
  computeShares,
  DomainError,
  validatePayers,
  type SplitInput,
  type TransactionSnapshot,
} from '@fairshare/core';
import { aiRequests, findPgError, withTx, type Db, type Tx } from '@fairshare/db';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../http/errors';
import { recordActivity } from '../activity/record';
import * as groupsRepo from '../groups/repo';
import { invalid, type Membership } from '../groups/service';
import * as repo from './repo';

export type TransactionsService = ReturnType<typeof createTransactionsService>;

/** The money facts of an expense, computed exactly as the browser's preview does (seed = its ID). */
type PreparedExpense = {
  snapshot: TransactionSnapshot;
  lines: repo.TransactionLines;
};

/**
 * `clock` is injectable so tests can pin "today" (the latest allowed date is today + 365 days).
 */
export function createTransactionsService(db: Db, clock: () => Date = () => new Date()) {
  /** The transaction, if the caller is an active member of its (live) group; otherwise 404. */
  async function access(handle: Db | Tx, me: string, id: string) {
    const row = await repo.findTransaction(handle, id);
    const membership = row && (await groupsRepo.findActiveMembership(handle, row.groupId, me));
    if (!row || !membership) {
      throw new AppError('NOT_FOUND', 'This expense doesn’t exist, or you’re not in its group.');
    }
    return { row, group: membership.group };
  }

  /** Full API shapes for rows, with their lines and the people they mention. */
  async function present(rows: repo.TransactionRow[], me: string): Promise<Transaction[]> {
    const lines = await repo.linesFor(
      db,
      rows.map((r) => r.id),
    );
    const ids = rows.flatMap((r) => [r.createdBy, ...(r.updatedBy ? [r.updatedBy] : [])]);
    const people = await repo.people(db, ids);
    return rows.map((row) => toTransaction(row, lines.get(row.id)!, people, me));
  }

  async function one(id: string, me: string): Promise<Transaction> {
    const row = await repo.findTransaction(db, id);
    return (await present([row!], me))[0]!;
  }

  /** Checks an expense against the group (currency, date, members) and computes its lines. */
  async function prepareForGroup(
    tx: Tx,
    id: string,
    groupId: string,
    input: UpdateExpense,
  ): Promise<PreparedExpense> {
    const group = await repo.shareLockGroup(tx, groupId);
    if (input.currency !== group!.currency) {
      throw new AppError('CURRENCY_MISMATCH', `Use the group’s currency, ${group!.currency}.`, {
        expected: group!.currency,
        actual: input.currency,
      });
    }
    if (input.occurredOn > latestOccurredOn(isoDate(clock()))) {
      throw invalid(['occurredOn'], 'That date is too far in the future.');
    }
    const states = await repo.memberStates(tx, groupId);
    for (const userId of peopleIn(input)) {
      const active = states.get(userId.toLowerCase());
      if (active === undefined) {
        throw new AppError('NOT_A_MEMBER', 'Everyone in the expense must be in the group.', {
          userId,
        });
      }
      if (!active) {
        throw new AppError('MEMBER_INACTIVE', 'Someone in the expense has left the group.', {
          userId,
        });
      }
    }
    return prepareExpense(id, input);
  }

  async function checkAiRequest(tx: Tx, me: string, aiRequestId: number | undefined) {
    if (aiRequestId === undefined) return;
    const [row] = await tx
      .select({ id: aiRequests.id })
      .from(aiRequests)
      .where(and(eq(aiRequests.id, aiRequestId), eq(aiRequests.userId, me)));
    if (!row) throw invalid(['aiRequestId'], 'Unknown AI request');
  }

  return {
    /**
     * POST /groups/:groupId/expenses. The ID is the client's: a retry of the same expense by the
     * same person returns the stored one (200); anything else with that ID is ID_CONFLICT (C6).
     */
    async createExpense(
      me: string,
      membership: Membership,
      input: CreateExpense,
    ): Promise<{ transaction: Transaction; created: boolean }> {
      const id = input.id.toLowerCase();
      const replay = async () => {
        const existing = await repo.findTransaction(db, id);
        if (existing && (await isSameExpense(db, existing, me, membership.groupId, input))) {
          return { transaction: await one(id, me), created: false };
        }
        throw new AppError('ID_CONFLICT', 'Another expense already has this ID.');
      };
      if (await repo.findTransaction(db, id)) return replay();

      try {
        await withTx(db, async (tx) => {
          await checkAiRequest(tx, me, input.aiRequestId);
          const { snapshot, lines } = await prepareForGroup(tx, id, membership.groupId, input);
          await repo.insertTransaction(
            tx,
            {
              id,
              groupId: membership.groupId,
              type: 'expense',
              ...columnsOf(snapshot),
              source: input.aiRequestId === undefined ? 'manual' : 'ai_text',
              aiRequestId: input.aiRequestId ?? null,
              createdBy: me,
            },
            lines,
          );
          await recordActivity(tx, {
            groupId: membership.groupId,
            actorId: me,
            verb: 'transaction.created',
            entityType: 'transaction',
            entityId: id,
            after: snapshot,
          });
        });
      } catch (error) {
        // Two requests with the same new ID at once: the loser hits the primary key.
        if (findPgError(error)?.code === '23505') return replay();
        throw error;
      }
      return { transaction: await one(id, me), created: true };
    },

    /** GET /transactions/:id, deleted ones included (so they can be restored). */
    async getTransaction(me: string, id: string): Promise<Transaction> {
      const { row } = await access(db, me, id);
      return (await present([row], me))[0]!;
    },

    /** GET /groups/:groupId/transactions: newest first, keyset-paginated. */
    async listTransactions(
      me: string,
      membership: Membership,
      query: TransactionListQuery,
    ): Promise<TransactionPage> {
      const rows = await repo.listTransactions(db, membership.groupId, {
        after: query.cursor ? decodeCursor(query.cursor) : undefined,
        limit: query.limit,
        q: query.q,
        person: query.person,
        type: query.type,
        from: query.from,
        to: query.to,
        includeDeleted: query.includeDeleted ?? false,
      });
      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        items: await present(pageRows, me),
        nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
      };
    },

    /**
     * PUT /transactions/:id with If-Match: replaces the expense. A stale version is
     * VERSION_CONFLICT with the current one, so the UI can reload; an unchanged body is a no-op.
     */
    async updateExpense(
      me: string,
      id: string,
      ifMatch: number,
      input: UpdateExpense,
    ): Promise<Transaction> {
      await withTx(db, async (tx) => {
        const row = await lockedForWrite(tx, me, id, ifMatch);
        if (row.deletedAt) {
          throw new AppError('TRANSACTION_DELETED', 'This expense was deleted. Restore it first.');
        }
        if (row.type !== 'expense') {
          throw new AppError('VALIDATION_FAILED', 'Editing settlements isn’t available yet.');
        }
        await checkAiRequest(tx, me, input.aiRequestId);
        const after = await prepareForGroup(tx, row.id, row.groupId, input);
        const before = snapshotOf(row, (await repo.linesFor(tx, [row.id])).get(row.id)!);
        if (sameSnapshot(before, after.snapshot)) return;

        await repo.replaceLines(tx, row.id, after.lines);
        await repo.saveEdit(tx, row.id, columnsOf(after.snapshot), row.version + 1, me);
        await recordActivity(tx, {
          groupId: row.groupId,
          actorId: me,
          verb: 'transaction.updated',
          entityType: 'transaction',
          entityId: row.id,
          before,
          after: after.snapshot,
        });
      });
      return one(id.toLowerCase(), me);
    },

    /** DELETE /transactions/:id with If-Match: a soft delete; balances drop it at once. */
    async deleteTransaction(me: string, id: string, ifMatch: number): Promise<DeletedTransaction> {
      return withTx(db, async (tx) => {
        const row = await lockedForWrite(tx, me, id, ifMatch);
        if (row.deletedAt) {
          return { id: row.id, version: row.version, deletedAt: row.deletedAt.toISOString() };
        }
        const lines = (await repo.linesFor(tx, [row.id])).get(row.id)!;
        const deleted = await repo.softDelete(tx, row.id, row.version + 1, me);
        await recordActivity(tx, {
          groupId: row.groupId,
          actorId: me,
          verb: 'transaction.deleted',
          entityType: 'transaction',
          entityId: row.id,
          before: snapshotOf(row, lines),
        });
        return {
          id: deleted.id,
          version: deleted.version,
          deletedAt: deleted.deletedAt!.toISOString(),
        };
      });
    },

    /**
     * POST /transactions/:id/restore with If-Match. Only while everyone in it is still an active
     * member (MEMBER_INACTIVE otherwise): the ledger can't hold debts for people who left.
     */
    async restoreTransaction(me: string, id: string, ifMatch: number): Promise<Transaction> {
      await withTx(db, async (tx) => {
        const row = await lockedForWrite(tx, me, id, ifMatch);
        if (!row.deletedAt) return;
        await repo.shareLockGroup(tx, row.groupId);
        const lines = (await repo.linesFor(tx, [row.id])).get(row.id)!;
        const states = await repo.memberStates(tx, row.groupId);
        for (const { userId } of [...lines.payers, ...lines.shares]) {
          if (states.get(userId) !== true) {
            throw new AppError(
              'MEMBER_INACTIVE',
              'Someone in this expense has left the group, so it can’t be restored.',
              { userId },
            );
          }
        }
        await repo.undelete(tx, row.id, row.version + 1);
        await recordActivity(tx, {
          groupId: row.groupId,
          actorId: me,
          verb: 'transaction.restored',
          entityType: 'transaction',
          entityId: row.id,
          after: snapshotOf(row, lines),
        });
      });
      return one(id.toLowerCase(), me);
    },

    /** GET /transactions/:id/history: every recorded change, oldest first. */
    async history(me: string, id: string): Promise<TransactionHistory> {
      const { row, group } = await access(db, me, id);
      const entries = await repo.historyOf(db, row.id);
      const people = await repo.people(
        db,
        entries.flatMap((e) => [e.actorId, ...(e.targetUser ? [e.targetUser] : [])]),
      );
      const items: ActivityEntry[] = entries.map((entry) => ({
        id: entry.id,
        groupId: entry.groupId,
        groupName: group.kind === 'direct' ? null : group.name,
        actor: toUserRef(people.get(entry.actorId)!),
        verb: entry.verb as ActivityEntry['verb'],
        entityType: entry.entityType,
        entityId: entry.entityId,
        target: entry.targetUser ? toUserRef(people.get(entry.targetUser)!) : null,
        before: (entry.before as Record<string, unknown> | null) ?? null,
        after: (entry.after as Record<string, unknown> | null) ?? null,
        createdAt: entry.createdAt.toISOString(),
        involvesMe: [entry.before, entry.after].some((s) => snapshotInvolves(s, me)),
      }));
      return { items };
    },
  };

  /** Locks the row for a write, after checking access and the If-Match version. */
  async function lockedForWrite(tx: Tx, me: string, id: string, ifMatch: number) {
    const row = await repo.lockTransaction(tx, id.toLowerCase());
    if (!row || !(await groupsRepo.findActiveMembership(tx, row.groupId, me))) {
      throw new AppError('NOT_FOUND', 'This expense doesn’t exist, or you’re not in its group.');
    }
    if (row.version !== ifMatch) {
      throw new AppError('VERSION_CONFLICT', 'Someone changed this expense in the meantime.', {
        currentVersion: row.version,
      });
    }
    return row;
  }
}

/** Core's checks and computation: payers, shares (seeded by the ID), invariants. No database. */
export function prepareExpense(id: string, input: UpdateExpense): PreparedExpense {
  const payers = validatePayers(input.amount, input.payers.map(lower));
  const split = lowerSplit(input.split);
  const shares = computeShares(input.amount, split, id);
  assertTransactionInvariants({
    id,
    type: 'expense',
    currency: input.currency,
    amount: input.amount,
    payers,
    shares,
  });
  const snapshot = canonicalSnapshot({
    description: input.description,
    amount: input.amount,
    currency: input.currency,
    occurredOn: input.occurredOn,
    notes: input.notes ? input.notes : null,
    splitMethod: split.method,
    splitInput: split,
    payers,
    shares,
  });
  return { snapshot, lines: { payers: snapshot.payers, shares: snapshot.shares } };
}

/** Whether a stored expense is exactly what this request would create (an idempotent replay). */
async function isSameExpense(
  db: Db,
  row: repo.TransactionRow,
  me: string,
  groupId: string,
  input: CreateExpense,
): Promise<boolean> {
  if (row.createdBy !== me || row.groupId !== groupId || row.type !== 'expense') return false;
  let requested: PreparedExpense;
  try {
    requested = prepareExpense(row.id, input);
  } catch (error) {
    if (error instanceof DomainError) return false; // a body that couldn't be the same expense
    throw error;
  }
  const stored = (await repo.linesFor(db, [row.id])).get(row.id)!;
  return sameSnapshot(snapshotOf(row, stored), requested.snapshot);
}

const sameSnapshot = (a: TransactionSnapshot, b: TransactionSnapshot) =>
  JSON.stringify(canonicalSnapshot(a)) === JSON.stringify(canonicalSnapshot(b));

/** The snapshot of a stored row (Blueprint 4.9 format). */
export function snapshotOf(row: repo.TransactionRow, lines: repo.TransactionLines) {
  return canonicalSnapshot({
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    occurredOn: row.occurredOn,
    notes: row.notes,
    splitMethod: row.splitMethod,
    splitInput: row.splitInput as SplitInput | null,
    payers: lines.payers,
    shares: lines.shares,
  });
}

const columnsOf = (s: TransactionSnapshot) => ({
  description: s.description,
  notes: s.notes,
  currency: s.currency,
  amount: s.amount,
  occurredOn: s.occurredOn,
  splitMethod: s.splitMethod,
  splitInput: s.splitInput,
});

function toTransaction(
  row: repo.TransactionRow,
  lines: repo.TransactionLines,
  people: Map<string, repo.PersonRow>,
  me: string,
): Transaction {
  const sum = (list: { userId: string; amount: number }[]) =>
    list.filter((l) => l.userId === me).reduce((total, l) => total + l.amount, 0);
  const common = {
    id: row.id,
    groupId: row.groupId,
    description: row.description,
    notes: row.notes,
    amount: row.amount,
    currency: row.currency,
    occurredOn: row.occurredOn,
    createdBy: toUserRef(people.get(row.createdBy)!),
    updatedBy: row.updatedBy ? toUserRef(people.get(row.updatedBy)!) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    version: row.version,
    myNet: sum(lines.payers) - sum(lines.shares),
  };
  if (row.type === 'settlement') {
    return {
      ...common,
      type: 'settlement',
      splitMethod: null,
      splitInput: null,
      payers: [lines.payers[0]!],
      shares: [lines.shares[0]!],
      paymentMethod: row.paymentMethod!,
      paymentRef: row.paymentRef,
    };
  }
  return {
    ...common,
    type: 'expense',
    splitMethod: row.splitMethod!,
    splitInput: row.splitInput as SplitInput | null,
    payers: lines.payers,
    shares: lines.shares,
    paymentMethod: null,
    paymentRef: null,
  };
}

const toUserRef = (p: repo.PersonRow): UserRef => ({
  id: p.id,
  name: p.name,
  avatarUrl: p.avatarUrl,
  isPlaceholder: p.isPlaceholder,
});

/** Everyone an expense names: payers and every person listed in the split, zero shares included. */
function peopleIn(input: UpdateExpense): string[] {
  const split = input.split;
  const inSplit =
    split.method === 'equal'
      ? split.participants
      : split.method === 'exact'
        ? split.amounts.map((a) => a.userId)
        : split.method === 'percent'
          ? split.basisPoints.map((p) => p.userId)
          : split.shares.map((s) => s.userId);
  return [...new Set([...input.payers.map((p) => p.userId), ...inSplit])];
}

/** IDs are compared as Postgres prints them: lower case. */
const lower = <T extends { userId: string }>(line: T): T => ({
  ...line,
  userId: line.userId.toLowerCase(),
});

function lowerSplit(split: SplitInput): SplitInput {
  switch (split.method) {
    case 'equal':
      return { method: 'equal', participants: split.participants.map((u) => u.toLowerCase()) };
    case 'exact':
      return { method: 'exact', amounts: split.amounts.map(lower) };
    case 'percent':
      return { method: 'percent', basisPoints: split.basisPoints.map(lower) };
    case 'shares':
      return { method: 'shares', shares: split.shares.map(lower) };
  }
}

function snapshotInvolves(snapshot: unknown, me: string): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const { payers, shares } = snapshot as {
    payers?: { userId: string }[];
    shares?: { userId: string }[];
  };
  return [...(payers ?? []), ...(shares ?? [])].some((l) => l.userId === me);
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Cursors are base64url JSON of the last row's [occurredOn, id], opaque to clients. */
export function encodeCursor(row: Pick<repo.TransactionRow, 'occurredOn' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.occurredOn, row.id])).toString('base64url');
}

export function decodeCursor(cursor: string): [string, string] {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[1])
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // fall through
  }
  throw invalid(['cursor'], 'Invalid cursor');
}
