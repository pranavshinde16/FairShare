// The repair of expenses claimed before claims rewrote split inputs: seeded broken rows, as a claim
// used to leave them (payer and share rows repointed, split_input still naming the placeholder).

import { renameInSplit, type SplitInput } from '@fairshare/core';
import { transactions, transactionShares, users } from '@fairshare/db';
import { insertGroup, insertTransaction, insertUser } from '@fairshare/db/testing';
import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationApp } from '../../testing/integration';
import { repairClaimedSplitInputs } from './repair';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

async function row(id: string) {
  const [tx] = await ctx.db.select().from(transactions).where(eq(transactions.id, id));
  return tx!;
}

const shares = (id: string) =>
  ctx.db
    .select({ userId: transactionShares.userId, amount: transactionShares.amount })
    .from(transactionShares)
    .where(eq(transactionShares.transactionId, id))
    .orderBy(asc(transactionShares.userId));

describe('repairClaimedSplitInputs', () => {
  it('renames claimed placeholders in every split input naming them, once', async () => {
    const asha = await insertUser(ctx.db, { name: 'Asha' });
    const chitra = await insertUser(ctx.db, { name: 'Chitra' });
    const bilal = await insertUser(ctx.db, { name: 'Bilal' });
    const placeholder = await insertUser(ctx.db, { name: 'Bilal', isPlaceholder: true });
    await ctx.db.update(users).set({ mergedInto: bilal.id }).where(eq(users.id, placeholder.id));
    const group = await insertGroup(ctx.db, [asha.id, bilal.id, chitra.id]);
    const friendship = await insertGroup(ctx.db, [asha.id, bilal.id]);
    const [a, p, b, c] = [asha.id, placeholder.id, bilal.id, chitra.id];

    /** An expense as a claim used to leave it: rows on Bilal, the input on the placeholder. */
    const broken = (split: SplitInput, lines: { userId: string; amount: number }[], extra = {}) =>
      insertTransaction(ctx.db, {
        groupId: group.id,
        createdBy: a,
        amount: 90,
        payers: [{ userId: a, amount: 90 }],
        shares: lines,
        splitMethod: split.method,
        splitInput: split,
        ...extra,
      });
    const thirds = [
      { userId: a, amount: 30 },
      { userId: b, amount: 30 },
      { userId: c, amount: 30 },
    ];
    const ids = [
      await broken({ method: 'equal', participants: [a, p, c] }, thirds),
      await broken(
        {
          method: 'exact',
          amounts: [
            { userId: a, amount: 30 },
            { userId: p, amount: 30 },
            { userId: c, amount: 30 },
          ],
        },
        thirds,
      ),
      await broken(
        {
          method: 'percent',
          basisPoints: [
            { userId: a, bp: 3334 },
            { userId: p, bp: 3333 },
            { userId: c, bp: 3333 },
          ],
        },
        thirds,
      ),
      await broken(
        {
          method: 'shares',
          shares: [
            { userId: a, shares: 1 },
            { userId: p, shares: 1 },
            { userId: c, shares: 1 },
          ],
        },
        thirds,
      ),
      await broken({ method: 'equal', participants: [a, p, c] }, thirds, {
        deletedAt: new Date(),
        deletedBy: a,
      }),
      // One that moved into Bilal's own friendship when the duplicate friendship was merged.
      await broken(
        { method: 'equal', participants: [a, p] },
        [
          { userId: a, amount: 45 },
          { userId: b, amount: 45 },
        ],
        { groupId: friendship.id },
      ),
    ];
    const untouched = await broken({ method: 'equal', participants: [a, b, c] }, thirds);
    const settlement = await insertTransaction(ctx.db, {
      groupId: group.id,
      createdBy: a,
      type: 'settlement',
      amount: 50,
      payers: [{ userId: b, amount: 50 }],
      shares: [{ userId: a, amount: 50 }],
    });
    const before = await Promise.all(ids.map(row));
    const sharesBefore = await Promise.all(ids.map(shares));

    expect(await repairClaimedSplitInputs(ctx.db)).toEqual({ repaired: ids.length });

    for (const [i, id] of ids.entries()) {
      const after = await row(id);
      expect(after.splitInput).toEqual(renameInSplit(before[i]!.splitInput as SplitInput, p, b));
      expect(after.version).toBe(before[i]!.version + 1);
      expect(after.updatedAt).toEqual(before[i]!.updatedAt);
      expect(after.updatedBy).toEqual(before[i]!.updatedBy);
      expect(await shares(id)).toEqual(sharesBefore[i]);
    }
    expect((await row(untouched)).version).toBe(1);
    expect((await row(settlement)).version).toBe(1);

    // Idempotent: nothing left to repair.
    expect(await repairClaimedSplitInputs(ctx.db)).toEqual({ repaired: 0 });
    for (const [i, id] of ids.entries())
      expect((await row(id)).version).toBe(before[i]!.version + 1);
  });
});
