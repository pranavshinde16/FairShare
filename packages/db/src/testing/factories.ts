// Minimal row builders for integration tests. They write rows directly, bypassing core and the
// services, so tests can also build data that the database itself must reject.

import { randomUUID } from 'node:crypto';
import { withTx, type Db } from '../client';
import {
  groupMembers,
  groups,
  transactionPayers,
  transactions,
  transactionShares,
  users,
} from '../schema';

type Line = { userId: string; amount: number };

export async function insertUser(db: Db, values: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), name: 'Test user', ...values })
    .returning();
  return user!;
}

/** A regular group whose first member is the owner. */
export async function insertGroup(db: Db, memberIds: string[], currency = 'INR') {
  const [group] = await db
    .insert(groups)
    .values({
      id: randomUUID(),
      kind: 'group',
      name: 'Test group',
      currency,
      createdBy: memberIds[0]!,
    })
    .returning();
  await db
    .insert(groupMembers)
    .values(
      memberIds.map(
        (userId, i) =>
          ({ groupId: group!.id, userId, role: i === 0 ? 'owner' : 'member' }) as const,
      ),
    );
  return group!;
}

export type TransactionInput = Partial<typeof transactions.$inferInsert> & {
  groupId: string;
  createdBy: string;
  amount: number;
  payers: Line[];
  shares: Line[];
};

/**
 * Inserts a transaction and its rows in one database transaction. Defaults to an INR expense with
 * an exact split. Rejects at COMMIT if the ledger trigger finds a problem.
 */
export async function insertTransaction(db: Db, { payers, shares, ...values }: TransactionInput) {
  const id = values.id ?? randomUUID();
  const settlement = values.type === 'settlement';
  await withTx(db, async (tx) => {
    await tx.insert(transactions).values({
      id,
      type: 'expense',
      description: settlement ? 'Settlement' : 'Test expense',
      currency: 'INR',
      occurredOn: '2026-11-05',
      splitMethod: settlement ? null : 'exact',
      paymentMethod: settlement ? 'cash' : null,
      ...values,
    });
    if (payers.length) {
      await tx.insert(transactionPayers).values(payers.map((l) => ({ transactionId: id, ...l })));
    }
    if (shares.length) {
      await tx.insert(transactionShares).values(shares.map((l) => ({ transactionId: id, ...l })));
    }
  });
  return id;
}
