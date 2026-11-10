// The commit-time ledger checks (I1–I3, I9) and the ledger view (I4).

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError, isLedgerInvariantError, withTx } from './client';
import { activityLog, ledger, transactionPayers, transactions, transactionShares } from './schema';
import {
  createTestDatabase,
  insertGroup,
  insertTransaction,
  insertUser,
  type TestDatabase,
} from './testing';

let t: TestDatabase;
let a: string, b: string, c: string, groupId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  [a, b, c] = await Promise.all(
    ['A', 'B', 'C'].map(async (name) => (await insertUser(t.db, { name })).id),
  ).then((ids) => ids as [string, string, string]);
  groupId = (await insertGroup(t.db, [a, b, c])).id;
});
afterAll(() => t.drop());

/** Awaits a rejection and returns the Postgres error's code and constraint. */
async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => expect.fail('expected the database to reject this'),
    (e: unknown) => e,
  );
  return { error, ...findPgError(error) };
}

const expense = (amount: number, payers: [string, number][], shares: [string, number][]) =>
  insertTransaction(t.db, {
    groupId,
    createdBy: a,
    amount,
    payers: payers.map(([userId, amt]) => ({ userId, amount: amt })),
    shares: shares.map(([userId, amt]) => ({ userId, amount: amt })),
  });

async function netsOf(group = groupId) {
  const rows = await t.db
    .select({
      userId: ledger.userId,
      currency: ledger.currency,
      net: sql<string>`sum(${ledger.amount})`,
    })
    .from(ledger)
    .where(eq(ledger.groupId, group))
    .groupBy(ledger.userId, ledger.currency);
  return Object.fromEntries(rows.map((r) => [`${r.userId}:${r.currency}`, Number(r.net)]));
}

const exists = async (id: string) =>
  (await t.db.select().from(transactions).where(eq(transactions.id, id))).length === 1;

describe('commit-time sum check (deferred trigger)', () => {
  it('accepts a balanced expense written row by row inside one transaction', async () => {
    const id = await expense(
      90_000,
      [[a, 90_000]],
      [
        [a, 30_000],
        [b, 30_000],
        [c, 30_000],
      ],
    );
    expect(await exists(id)).toBe(true);
  });

  it('rejects shares that don’t add up, at COMMIT, and rolls everything back', async () => {
    const id = crypto.randomUUID();
    const result = await rejection(
      withTx(t.db, async (tx) => {
        await tx.insert(transactions).values({
          id,
          groupId,
          type: 'expense',
          description: 'Dinner',
          currency: 'INR',
          amount: 120_000,
          occurredOn: '2026-11-05',
          splitMethod: 'exact',
          createdBy: a,
        });
        await tx
          .insert(transactionPayers)
          .values({ transactionId: id, userId: a, amount: 120_000 });
        await tx
          .insert(transactionShares)
          .values({ transactionId: id, userId: b, amount: 110_000 });
        // Written in the same transaction, so it must disappear with it.
        await tx.insert(activityLog).values({
          groupId,
          actorId: a,
          verb: 'transaction.created',
          entityType: 'transaction',
          entityId: id,
        });
      }),
    );
    expect(result).toMatchObject({ code: '23514', constraint: 'transaction_sums' });
    expect(isLedgerInvariantError(result.error)).toBe(true);
    expect(await exists(id)).toBe(false);
    expect(await t.db.select().from(activityLog).where(eq(activityLog.entityId, id))).toEqual([]);
  });

  it('rejects payers that don’t add up', async () => {
    const result = await rejection(
      expense(
        100,
        [
          [a, 60],
          [b, 30],
        ],
        [[a, 100]],
      ),
    );
    expect(result.constraint).toBe('transaction_sums');
  });

  it('rejects a transaction with no rows at all', async () => {
    const result = await rejection(expense(100, [], []));
    expect(result.constraint).toBe('transaction_sums');
  });

  it('rejects changing the amount without replacing the rows', async () => {
    const id = await expense(
      300,
      [[a, 300]],
      [
        [a, 150],
        [b, 150],
      ],
    );
    const result = await rejection(
      t.db.update(transactions).set({ amount: 400 }).where(eq(transactions.id, id)),
    );
    expect(result.constraint).toBe('transaction_sums');
  });

  it('rejects removing or changing a single share', async () => {
    const id = await expense(
      300,
      [[a, 300]],
      [
        [a, 150],
        [b, 150],
      ],
    );
    const removed = await rejection(
      t.db
        .delete(transactionShares)
        .where(and(eq(transactionShares.transactionId, id), eq(transactionShares.userId, b))),
    );
    expect(removed.constraint).toBe('transaction_sums');
    const changed = await rejection(
      t.db
        .update(transactionShares)
        .set({ amount: 100 })
        .where(and(eq(transactionShares.transactionId, id), eq(transactionShares.userId, b))),
    );
    expect(changed.constraint).toBe('transaction_sums');
  });

  it('checks both transactions when a row moves from one to another', async () => {
    const from = await expense(
      200,
      [[a, 200]],
      [
        [a, 100],
        [b, 100],
      ],
    );
    const to = await expense(100, [[a, 100]], [[a, 100]]);
    const result = await rejection(
      t.db
        .update(transactionShares)
        .set({ transactionId: to })
        .where(and(eq(transactionShares.transactionId, from), eq(transactionShares.userId, b))),
    );
    expect(result.constraint).toBe('transaction_sums');
  });

  it('accepts the edit path: replace every row and the amount together', async () => {
    const id = await expense(
      300,
      [[a, 300]],
      [
        [a, 150],
        [b, 150],
      ],
    );
    await withTx(t.db, async (tx) => {
      await tx.delete(transactionPayers).where(eq(transactionPayers.transactionId, id));
      await tx.delete(transactionShares).where(eq(transactionShares.transactionId, id));
      await tx.update(transactions).set({ amount: 600, version: 2 }).where(eq(transactions.id, id));
      await tx.insert(transactionPayers).values({ transactionId: id, userId: b, amount: 600 });
      await tx.insert(transactionShares).values([
        { transactionId: id, userId: a, amount: 200 },
        { transactionId: id, userId: b, amount: 200 },
        { transactionId: id, userId: c, amount: 200 },
      ]);
    });
    const [row] = await t.db.select().from(transactions).where(eq(transactions.id, id));
    expect(row).toMatchObject({ amount: 600, version: 2 });
  });

  it('lets a whole transaction be removed with its rows (owner-only maintenance)', async () => {
    const id = await expense(100, [[a, 100]], [[b, 100]]);
    await t.db.delete(transactions).where(eq(transactions.id, id));
    expect(await exists(id)).toBe(false);
    expect(
      await t.db.select().from(transactionShares).where(eq(transactionShares.transactionId, id)),
    ).toEqual([]);
  });
});

describe('settlement shape (I9)', () => {
  const settle = (payers: [string, number][], shares: [string, number][]) =>
    insertTransaction(t.db, {
      groupId,
      createdBy: b,
      type: 'settlement',
      amount: 500,
      payers: payers.map(([userId, amount]) => ({ userId, amount })),
      shares: shares.map(([userId, amount]) => ({ userId, amount })),
    });

  it('accepts one payer and one different recipient', async () => {
    expect(await exists(await settle([[b, 500]], [[a, 500]]))).toBe(true);
  });

  it('rejects two payers, even when the sums are right', async () => {
    const result = await rejection(
      settle(
        [
          [b, 250],
          [c, 250],
        ],
        [[a, 500]],
      ),
    );
    expect(result).toMatchObject({ code: '23514', constraint: 'settlement_shape' });
    expect(isLedgerInvariantError(result.error)).toBe(true);
  });

  it('rejects two recipients', async () => {
    expect(
      (
        await rejection(
          settle(
            [[b, 500]],
            [
              [a, 250],
              [c, 250],
            ],
          ),
        )
      ).constraint,
    ).toBe('settlement_shape');
  });

  it('rejects paying yourself', async () => {
    expect((await rejection(settle([[b, 500]], [[b, 500]]))).constraint).toBe('settlement_shape');
  });
});

describe('ledger view', () => {
  let g: string;
  beforeAll(async () => {
    g = (await insertGroup(t.db, [a, b, c])).id;
  });

  const nets = () => netsOf(g);

  it('is paid − share per user, and sums to zero (I3, I6)', async () => {
    await insertTransaction(t.db, {
      groupId: g,
      createdBy: a,
      amount: 90_000,
      payers: [{ userId: a, amount: 90_000 }],
      shares: [a, b, c].map((userId) => ({ userId, amount: 30_000 })),
    });
    expect(await nets()).toEqual({
      [`${a}:INR`]: 60_000,
      [`${b}:INR`]: -30_000,
      [`${c}:INR`]: -30_000,
    });
  });

  it('treats a settlement as payer + and recipient −', async () => {
    await insertTransaction(t.db, {
      groupId: g,
      createdBy: b,
      type: 'settlement',
      amount: 30_000,
      payers: [{ userId: b, amount: 30_000 }],
      shares: [{ userId: a, amount: 30_000 }],
    });
    expect(await nets()).toMatchObject({ [`${a}:INR`]: 30_000, [`${b}:INR`]: 0 });
  });

  it('excludes deleted transactions and includes them again on restore (I4)', async () => {
    const id = await insertTransaction(t.db, {
      groupId: g,
      createdBy: c,
      amount: 10_000,
      payers: [{ userId: c, amount: 10_000 }],
      shares: [{ userId: a, amount: 10_000 }],
    });
    const withIt = await nets();
    await t.db
      .update(transactions)
      .set({ deletedAt: new Date(), deletedBy: c })
      .where(eq(transactions.id, id));
    expect((await nets())[`${c}:INR`]).toBe(withIt[`${c}:INR`]! - 10_000);
    await t.db
      .update(transactions)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(transactions.id, id));
    expect(await nets()).toEqual(withIt);
  });

  it('keeps currencies apart', async () => {
    await insertTransaction(t.db, {
      groupId: g,
      createdBy: a,
      currency: 'USD',
      amount: 1_000,
      payers: [{ userId: a, amount: 1_000 }],
      shares: [{ userId: b, amount: 1_000 }],
    });
    const all = await nets();
    expect(all).toMatchObject({ [`${a}:USD`]: 1_000, [`${b}:USD`]: -1_000 });
    for (const currency of ['INR', 'USD']) {
      const sum = Object.entries(all)
        .filter(([k]) => k.endsWith(currency))
        .reduce((s, [, v]) => s + v, 0);
      expect(sum).toBe(0);
    }
  });

  it('returns amounts as numbers, not strings', async () => {
    const [row] = await t.db.select().from(ledger).where(eq(ledger.groupId, g)).limit(1);
    expect(typeof row!.amount).toBe('number');
  });
});

describe('isLedgerInvariantError', () => {
  it('is false for other constraint errors and ordinary errors', async () => {
    const amountCheck = await rejection(expense(0, [[a, 1]], [[a, 1]]));
    expect(amountCheck).toMatchObject({ code: '23514', constraint: 'transactions_amount_range' });
    expect(isLedgerInvariantError(amountCheck.error)).toBe(false);
    expect(isLedgerInvariantError(new Error('boom'))).toBe(false);
    expect(isLedgerInvariantError(null)).toBe(false);
    expect(findPgError({ cause: { cause: { code: '23505' } } })).toEqual({ code: '23505' });
  });
});

describe('indexes serve the planned queries', () => {
  const plan = async (query: string, ...params: unknown[]) => {
    const client = await t.pool.connect();
    try {
      await client.query('BEGIN');
      // Tiny tables would otherwise be scanned sequentially; this asks "can the index serve it?"
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${query}`, params);
      await client.query('ROLLBACK');
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
  };

  it('the group feed reads tx_group_feed in order, without a sort', async () => {
    const explain = await plan(
      `SELECT id FROM transactions WHERE group_id = $1 AND deleted_at IS NULL
       ORDER BY occurred_on DESC, id DESC LIMIT 30`,
      groupId,
    );
    expect(explain).toContain('tx_group_feed');
    expect(explain).not.toMatch(/\bSort\b/);
  });

  it('search uses the trigram index', async () => {
    const explain = await plan(
      `SELECT id FROM transactions WHERE (description || ' ' || coalesce(notes, '')) ILIKE $1`,
      '%dinner%',
    );
    expect(explain).toContain('tx_search');
  });
});
