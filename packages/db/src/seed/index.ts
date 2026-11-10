// Demo data for local development: the plan's Goa trip. Never run against production.
//
// Transactions are built exactly as the server will build them: payers validated and shares
// computed by core, settlement fields mapped by contracts, activity written alongside.

import { settlementColumns } from '@fairshare/contracts';
import {
  canonicalSnapshot,
  computeShares,
  settlementLines,
  validatePayers,
  type Line,
  type SplitInput,
  type TransactionSnapshot,
} from '@fairshare/core';
import { eq } from 'drizzle-orm';
import { withTx, type Db, type Tx } from '../client';
import {
  activityLog,
  auth_user,
  groupMembers,
  groups,
  transactionPayers,
  transactions,
  transactionShares,
  users,
} from '../schema';

const seedId = (suffix: string) => `01900000-0000-7000-8000-5eed${suffix.padStart(8, '0')}`;

/** Stable IDs, so tests and local tools can refer to seeded rows. */
export const SEED_IDS = {
  asha: seedId('a'),
  bilal: seedId('b'),
  chitra: seedId('c'),
  dev: seedId('d'),
  goa: seedId('100'),
  hotel: seedId('201'),
  dinner: seedId('202'),
  fuel: seedId('203'),
  settlement: seedId('204'),
} as const;

/** The two demo accounts. Sign in as either with email OTP once auth lands (Phase 5). */
export const SEED_ACCOUNTS = [
  { authId: 'seed-auth-asha', userId: SEED_IDS.asha, name: 'Asha', email: 'asha@example.com' },
  { authId: 'seed-auth-bilal', userId: SEED_IDS.bilal, name: 'Bilal', email: 'bilal@example.com' },
] as const;

const { asha: A, bilal: B, chitra: C, dev: D } = SEED_IDS;
const everyone = [A, B, C, D];

type Expense = {
  id: string;
  description: string;
  amount: number;
  occurredOn: string;
  createdBy: string;
  payers: Line[];
  split: SplitInput;
};

const hotel: Expense = {
  id: SEED_IDS.hotel,
  description: 'Hotel',
  amount: 400_000,
  occurredOn: '2026-10-10',
  createdBy: A,
  payers: [{ userId: A, amount: 400_000 }],
  split: { method: 'equal', participants: everyone },
};

const dinner: Expense = {
  id: SEED_IDS.dinner,
  description: 'Dinner',
  amount: 120_000,
  occurredOn: '2026-10-10',
  createdBy: B,
  payers: [{ userId: B, amount: 120_000 }],
  split: { method: 'equal', participants: [A, B, C] },
};

/** The bill was actually ₹1,500: corrected by Asha after the settlement. */
const dinnerCorrected: Expense = {
  ...dinner,
  amount: 150_000,
  payers: [{ userId: B, amount: 150_000 }],
};

const fuel: Expense = {
  id: SEED_IDS.fuel,
  description: 'Fuel',
  amount: 300_000,
  occurredOn: '2026-10-11',
  createdBy: C,
  payers: [
    { userId: C, amount: 200_000 },
    { userId: D, amount: 100_000 },
  ],
  split: { method: 'equal', participants: everyone },
};

const settlement = {
  fromUserId: B,
  toUserId: A,
  amount: 95_000,
  currency: 'INR',
  occurredOn: '2026-10-14',
  method: 'upi' as const,
  reference: '431298765012',
};

/**
 * Seeds the demo accounts and the Goa group. Returns 'already-seeded' without changing anything if
 * the group exists. Currencies must already be present (runMigrations applies them).
 */
export async function seedDemo(db: Db): Promise<'seeded' | 'already-seeded'> {
  return withTx(db, async (tx) => {
    const existing = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, SEED_IDS.goa));
    if (existing.length > 0) return 'already-seeded';

    await tx.insert(auth_user).values(
      SEED_ACCOUNTS.map((a) => ({
        id: a.authId,
        name: a.name,
        email: a.email,
        emailVerified: true,
      })),
    );
    await tx.insert(users).values([
      ...SEED_ACCOUNTS.map((a) => ({
        id: a.userId,
        authUserId: a.authId,
        name: a.name,
        email: a.email,
      })),
      { id: C, name: 'Chitra', isPlaceholder: true, createdBy: A },
      { id: D, name: 'Dev', email: 'dev@example.com', isPlaceholder: true, createdBy: A },
    ]);

    await tx.insert(groups).values({
      id: SEED_IDS.goa,
      kind: 'group',
      name: 'Goa Trip',
      emoji: '🏖️',
      currency: 'INR',
      createdBy: A,
    });
    await tx
      .insert(groupMembers)
      .values(
        everyone.map(
          (userId) =>
            ({ groupId: SEED_IDS.goa, userId, role: userId === A ? 'owner' : 'member' }) as const,
        ),
      );
    await log(tx, A, 'group.created', 'group', SEED_IDS.goa, { after: { name: 'Goa Trip' } });
    for (const userId of [B, C, D]) {
      await log(tx, A, 'member.added', 'member', userId, { targetUser: userId });
    }

    for (const expense of [hotel, dinner, fuel]) {
      const after = await insertExpense(tx, expense);
      await log(tx, expense.createdBy, 'transaction.created', 'transaction', expense.id, { after });
    }

    const lines = settlementLines(settlement);
    const columns = settlementColumns(settlement);
    await tx.insert(transactions).values({
      id: SEED_IDS.settlement,
      groupId: SEED_IDS.goa,
      type: 'settlement',
      ...columns,
      currency: settlement.currency,
      amount: settlement.amount,
      occurredOn: settlement.occurredOn,
      createdBy: B,
    });
    await insertLines(tx, SEED_IDS.settlement, lines.payers, lines.shares);
    await log(tx, B, 'transaction.created', 'transaction', SEED_IDS.settlement, {
      targetUser: A,
      after: canonicalSnapshot({
        description: columns.description,
        amount: settlement.amount,
        currency: settlement.currency,
        occurredOn: settlement.occurredOn,
        notes: columns.notes,
        splitMethod: null,
        splitInput: null,
        ...lines,
      }),
    });

    const before = snapshot(dinner, computeShares(dinner.amount, dinner.split, dinner.id));
    const after = await editExpense(tx, dinnerCorrected, A);
    await log(tx, A, 'transaction.updated', 'transaction', dinner.id, { before, after });

    return 'seeded';
  });
}

function snapshot(expense: Expense, shares: Line[]): TransactionSnapshot {
  return canonicalSnapshot({
    description: expense.description,
    amount: expense.amount,
    currency: 'INR',
    occurredOn: expense.occurredOn,
    notes: null,
    splitMethod: expense.split.method,
    splitInput: expense.split,
    payers: validatePayers(expense.amount, expense.payers),
    shares,
  });
}

async function insertExpense(tx: Tx, expense: Expense): Promise<TransactionSnapshot> {
  const shares = computeShares(expense.amount, expense.split, expense.id);
  await tx.insert(transactions).values({
    id: expense.id,
    groupId: SEED_IDS.goa,
    type: 'expense',
    description: expense.description,
    currency: 'INR',
    amount: expense.amount,
    occurredOn: expense.occurredOn,
    splitMethod: expense.split.method,
    splitInput: expense.split,
    createdBy: expense.createdBy,
  });
  await insertLines(tx, expense.id, validatePayers(expense.amount, expense.payers), shares);
  return snapshot(expense, shares);
}

/** The edit path: replace every payer and share row, bump the version, all in one transaction. */
async function editExpense(tx: Tx, expense: Expense, editor: string): Promise<TransactionSnapshot> {
  const shares = computeShares(expense.amount, expense.split, expense.id);
  await tx.delete(transactionPayers).where(eq(transactionPayers.transactionId, expense.id));
  await tx.delete(transactionShares).where(eq(transactionShares.transactionId, expense.id));
  await tx
    .update(transactions)
    .set({
      amount: expense.amount,
      splitInput: expense.split,
      version: 2,
      updatedBy: editor,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, expense.id));
  await insertLines(tx, expense.id, validatePayers(expense.amount, expense.payers), shares);
  return snapshot(expense, shares);
}

async function insertLines(tx: Tx, transactionId: string, payers: Line[], shares: Line[]) {
  await tx.insert(transactionPayers).values(payers.map((line) => ({ transactionId, ...line })));
  await tx.insert(transactionShares).values(shares.map((line) => ({ transactionId, ...line })));
}

async function log(
  tx: Tx,
  actorId: string,
  verb: string,
  entityType: 'group' | 'member' | 'transaction',
  entityId: string,
  extra: { targetUser?: string; before?: object; after?: object } = {},
) {
  await tx
    .insert(activityLog)
    .values({ groupId: SEED_IDS.goa, actorId, verb, entityType, entityId, ...extra });
}
