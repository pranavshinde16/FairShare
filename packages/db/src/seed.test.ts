// The demo seed: the database's balances must equal core's, and the plan's numbers.

import { TransactionSnapshot } from '@fairshare/contracts';
import {
  assertTransactionInvariants,
  diffSnapshots,
  netsFromTransactions,
  simplify,
  type LedgerTransaction,
} from '@fairshare/core';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  activityLog,
  auth_user,
  groupMembers,
  ledger,
  transactionPayers,
  transactions,
  transactionShares,
  users,
} from './schema';
import { SEED_IDS, seedDemo } from './seed';
import { createTestDatabase, type TestDatabase } from './testing';

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  expect(await seedDemo(t.db)).toBe('seeded');
});
afterAll(() => t.drop());

const { asha: A, bilal: B, chitra: C, dev: D } = SEED_IDS;

async function databaseNets() {
  const rows = await t.db
    .select({ userId: ledger.userId, net: sql<string>`sum(${ledger.amount})` })
    .from(ledger)
    .where(eq(ledger.groupId, SEED_IDS.goa))
    .groupBy(ledger.userId)
    .orderBy(asc(ledger.userId));
  return rows.map((r) => ({ userId: r.userId, amount: Number(r.net) }));
}

/** The stored transactions, read back into core's shape. */
async function storedTransactions(): Promise<LedgerTransaction[]> {
  const rows = await t.db.select().from(transactions).where(eq(transactions.groupId, SEED_IDS.goa));
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      type: row.type,
      currency: row.currency,
      amount: row.amount,
      payers: (
        await t.db
          .select()
          .from(transactionPayers)
          .where(eq(transactionPayers.transactionId, row.id))
      ).map(({ userId, amount }) => ({ userId, amount })),
      shares: (
        await t.db
          .select()
          .from(transactionShares)
          .where(eq(transactionShares.transactionId, row.id))
      ).map(({ userId, amount }) => ({ userId, amount })),
    })),
  );
}

describe('Goa seed', () => {
  it('matches the plan: A +₹800, B +₹200, C −₹250, D −₹750 after the dinner correction', async () => {
    expect(await databaseNets()).toEqual([
      { userId: A, amount: 80_000 },
      { userId: B, amount: 20_000 },
      { userId: C, amount: -25_000 },
      { userId: D, amount: -75_000 },
    ]);
  });

  it('matches core’s ledger math on the same stored rows', async () => {
    const stored = await storedTransactions();
    for (const tx of stored) assertTransactionInvariants(tx);
    const [inr] = netsFromTransactions(stored);
    expect(inr!.nets).toEqual(await databaseNets());
    expect(simplify(inr!.nets)).toEqual([
      { from: D, to: A, amount: 75_000 },
      { from: C, to: B, amount: 20_000 },
      { from: C, to: A, amount: 5_000 },
    ]);
  });

  it('stores the dinner as an edited expense (version 2) and the settlement as a settlement', async () => {
    const [dinner] = await t.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, SEED_IDS.dinner));
    expect(dinner).toMatchObject({
      amount: 150_000,
      version: 2,
      updatedBy: A,
      splitMethod: 'equal',
    });
    const [settlement] = await t.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, SEED_IDS.settlement));
    expect(settlement).toMatchObject({
      type: 'settlement',
      description: 'Settlement',
      paymentMethod: 'upi',
      paymentRef: '431298765012',
      notes: null,
      splitMethod: null,
    });
  });

  it('has two real accounts and two placeholders, Asha owning the group', async () => {
    const people = await t.db.select().from(users).orderBy(asc(users.id));
    expect(people.map((u) => [u.name, u.isPlaceholder, u.authUserId !== null])).toEqual([
      ['Asha', false, true],
      ['Bilal', false, true],
      ['Chitra', true, false],
      ['Dev', true, false],
    ]);
    expect(await t.db.select().from(auth_user)).toHaveLength(2);
    const owners = await t.db.select().from(groupMembers).where(eq(groupMembers.role, 'owner'));
    expect(owners.map((m) => m.userId)).toEqual([A]);
  });

  it('writes activity for every change, with snapshots core can diff', async () => {
    const entries = await t.db.select().from(activityLog).orderBy(asc(activityLog.id));
    expect(entries.map((e) => e.verb)).toEqual([
      'group.created',
      'member.added',
      'member.added',
      'member.added',
      'transaction.created',
      'transaction.created',
      'transaction.created',
      'transaction.created',
      'transaction.updated',
    ]);
    const update = entries.at(-1)!;
    const changes = diffSnapshots(
      TransactionSnapshot.parse(update.before),
      TransactionSnapshot.parse(update.after),
    );
    expect(changes[0]).toEqual({ field: 'amount', from: 120_000, to: 150_000 });
    expect(changes.map((c) => c.field)).toEqual(['amount', 'payers', 'shares']);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await t.db.select({ n: sql<number>`count(*)::int` }).from(activityLog);
    expect(await seedDemo(t.db)).toBe('already-seeded');
    expect(await t.db.select({ n: sql<number>`count(*)::int` }).from(activityLog)).toEqual(before);
  });
});
