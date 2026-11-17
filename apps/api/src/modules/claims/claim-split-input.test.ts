// Claiming a placeholder rewrites the expenses that name it, including their split input, so an
// expense opened and saved unchanged after the claim round-trips with the claimer in the
// placeholder's place, and stays a no-op (docs/dev-log/fix-claim-split-input.md).

import {
  ErrorEnvelope,
  Group,
  InviteCreated,
  Transaction,
  type CreateExpense,
  type ExpenseTransaction,
  type Line,
  type SplitInput,
  type UpdateExpense,
} from '@fairshare/contracts';
import { computeShares } from '@fairshare/core';
import { activityLog } from '@fairshare/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
type Who = { cookie: string; id: string };

async function groupWith(owner: Who, placeholders: string[]) {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name: 'Goa Trip',
    currency: 'INR',
    members: placeholders.map((name) => ({ name })),
  });
  return Group.parse(res.body);
}

async function tokenFor(owner: Who, groupId: string, target?: string) {
  const res = await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {
    ...(target && { targetPlaceholderId: target }),
  });
  return InviteCreated.parse(res.body).url.split('/').pop()!;
}

async function claim(who: Who, owner: Who, groupId: string, placeholderId: string) {
  const token = await tokenFor(owner, groupId, placeholderId);
  const res = await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {
    claimPlaceholderId: placeholderId,
  });
  expect(res.status).toBe(200);
}

/** A PUT/DELETE/restore with If-Match. */
async function write(
  who: Who,
  method: 'PUT' | 'DELETE' | 'POST',
  path: string,
  version: number,
  body?: unknown,
) {
  const res = await ctx.request(path, {
    method,
    cookie: who.cookie,
    body,
    headers: { 'If-Match': `"${version}"` },
  });
  return { status: res.status, body: await res.json() };
}

async function create(who: Who, groupId: string, body: CreateExpense): Promise<ExpenseTransaction> {
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, body);
  expect(res.status).toBe(201);
  return Transaction.parse(res.body) as ExpenseTransaction;
}

async function get(who: Who, id: string): Promise<ExpenseTransaction> {
  const res = await ctx.call(who, 'GET', `/api/v1/transactions/${id}`);
  expect(res.status).toBe(200);
  return Transaction.parse(res.body) as ExpenseTransaction;
}

/** The body an edit form would send back after opening this expense and changing nothing. */
const unchanged = (tx: ExpenseTransaction): UpdateExpense => ({
  description: tx.description,
  amount: tx.amount,
  currency: tx.currency,
  occurredOn: tx.occurredOn,
  ...(tx.notes !== null && { notes: tx.notes }),
  payers: tx.payers,
  split: tx.splitInput!,
});

const expense = (
  payers: Line[],
  split: SplitInput,
  amount = payers.reduce((sum, p) => sum + p.amount, 0),
): CreateExpense => ({
  id: uuidv7(),
  description: `Split by ${split.method}`,
  amount,
  currency: 'INR',
  occurredOn: '2026-11-10',
  payers,
  split,
});

/** Every user ID mentioned anywhere in a split input. */
const idsIn = (split: SplitInput | null) => JSON.stringify(split);

const swap = (lines: Line[], from: string, to: string) =>
  lines
    .map((l) => (l.userId === from ? { ...l, userId: to } : l))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

const updates = (id: string) =>
  ctx.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityId, id), eq(activityLog.verb, 'transaction.updated')));

/**
 * After the claim: the expense names the claimer everywhere, with the amounts it had before, and
 * saving it unchanged succeeds without changing anything.
 */
async function expectRoundTrip(
  owner: Who,
  before: ExpenseTransaction,
  placeholder: string,
  claimer: string,
) {
  const after = await get(owner, before.id);
  expect(idsIn(after.splitInput)).not.toContain(placeholder);
  expect(idsIn(after.splitInput)).toContain(claimer);
  expect(after.payers).toEqual(swap(before.payers, placeholder, claimer));
  expect(after.shares).toEqual(swap(before.shares, placeholder, claimer));

  const saved = await write(
    owner,
    'PUT',
    `/api/v1/transactions/${before.id}`,
    after.version,
    unchanged(after),
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const tx = Transaction.parse(saved.body) as ExpenseTransaction;
  expect(tx.version).toBe(after.version); // a no-op
  expect(tx.splitInput).toEqual(after.splitInput);
  expect(tx.payers).toEqual(after.payers);
  expect(tx.shares).toEqual(after.shares);
  expect(await updates(before.id)).toHaveLength(0);
}

describe('expenses naming a claimed placeholder', () => {
  it('round-trip with the claimer for every split method and several payers', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal', 'Chitra']);
    const [p, chitra] = group.members.slice(1).map((m) => m.user.id) as [string, string];
    const a = asha.id;

    const created = [
      await create(
        asha,
        group.id,
        expense([{ userId: a, amount: 100000 }], { method: 'equal', participants: [a, p, chitra] }),
      ),
      await create(
        asha,
        group.id,
        expense([{ userId: a, amount: 100000 }], {
          method: 'exact',
          amounts: [
            { userId: a, amount: 50000 },
            { userId: p, amount: 30000 },
            { userId: chitra, amount: 20000 },
          ],
        }),
      ),
      await create(
        asha,
        group.id,
        expense([{ userId: a, amount: 100000 }], {
          method: 'percent',
          basisPoints: [
            { userId: a, bp: 5000 },
            { userId: p, bp: 3333 },
            { userId: chitra, bp: 1667 },
          ],
        }),
      ),
      await create(
        asha,
        group.id,
        expense([{ userId: a, amount: 99999 }], {
          method: 'shares',
          shares: [
            { userId: a, shares: 2 },
            { userId: p, shares: 1 },
            { userId: chitra, shares: 1 },
          ],
        }),
      ),
      await create(
        asha,
        group.id,
        expense(
          [
            { userId: a, amount: 60000 },
            { userId: p, amount: 40001 },
          ],
          { method: 'equal', participants: [a, p, chitra] },
        ),
      ),
    ];
    const bilal = await person('bilal');

    await claim(bilal, asha, group.id, p);

    for (const before of created) await expectRoundTrip(asha, before, p, bilal.id);
  });

  it('includes a deleted expense, which round-trips after it’s restored', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal', 'Chitra']);
    const [p, chitra] = group.members.slice(1).map((m) => m.user.id) as [string, string];
    const before = await create(
      asha,
      group.id,
      expense([{ userId: asha.id, amount: 100000 }], {
        method: 'equal',
        participants: [asha.id, p, chitra],
      }),
    );
    expect((await write(asha, 'DELETE', `/api/v1/transactions/${before.id}`, 1)).status).toBe(200);
    const bilal = await person('bilal');

    await claim(bilal, asha, group.id, p);
    const deleted = await get(asha, before.id);
    const restored = await write(
      asha,
      'POST',
      `/api/v1/transactions/${before.id}/restore`,
      deleted.version,
    );
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);

    await expectRoundTrip(asha, before, p, bilal.id);
  });

  it('turns a form opened before the claim into a version conflict', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal', 'Chitra']);
    const [p, chitra] = group.members.slice(1).map((m) => m.user.id) as [string, string];
    const before = await create(
      asha,
      group.id,
      expense([{ userId: asha.id, amount: 100000 }], {
        method: 'equal',
        participants: [asha.id, p, chitra],
      }),
    );
    const bilal = await person('bilal');

    await claim(bilal, asha, group.id, p);
    const stale = await write(
      asha,
      'PUT',
      `/api/v1/transactions/${before.id}`,
      before.version,
      unchanged(before),
    );

    expect(stale.status).toBe(409);
    expect(code(stale.body)).toBe('VERSION_CONFLICT');
  });

  it('keeps the stored shares when the claimer’s ID would move a leftover paisa', async () => {
    // Leftover paise go by position in user-ID order. Asha < placeholder < Chitra < Bilal (UUIDv7
    // is time-ordered), so after the claim Bilal sorts last where the placeholder sorted second.
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const p = group.members[1]!.user.id;
    const added = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, {
      name: 'Chitra',
    });
    expect(added.status).toBe(201);
    const chitra = (await membersOf(asha, group.id)).find((id) => id !== asha.id && id !== p)!;
    const bilal = await person('bilal');

    // An expense ID whose seeded rounding differs once the placeholder's ID becomes Bilal's.
    let body: CreateExpense | undefined;
    for (let i = 0; i < 200 && !body; i++) {
      const candidate = expense([{ userId: asha.id, amount: 100000 }], {
        method: 'equal',
        participants: [asha.id, p, chitra],
      });
      const stored = swap(computeShares(100000, candidate.split, candidate.id), p, bilal.id);
      const renamed = computeShares(
        100000,
        { method: 'equal', participants: [asha.id, bilal.id, chitra] },
        candidate.id,
      );
      if (JSON.stringify(stored) !== JSON.stringify(renamed)) body = candidate;
    }
    expect(body, 'no expense ID moved a paisa').toBeDefined();
    const before = await create(asha, group.id, body!);

    await claim(bilal, asha, group.id, p);

    await expectRoundTrip(asha, before, p, bilal.id);
  });
});

async function membersOf(who: Who, groupId: string) {
  const res = await ctx.call(who, 'GET', `/api/v1/groups/${groupId}`);
  return Group.parse(res.body).members.map((m) => m.user.id);
}

describe('a placeholder friend', () => {
  it('round-trips after its expenses move into the friendship the claimer already had', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    // Asha and Bilal share a group and are friends.
    const shared = await groupWith(asha, []);
    await ctx.call(bilal, 'POST', `/api/v1/invites/${await tokenFor(asha, shared.id)}/accept`, {});
    const real = (await ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id })).body as {
      groupId: string;
    };
    // Asha also made a placeholder "Bilal" as a friend and logged expenses with it.
    const duplicate = (await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' })).body as {
      groupId: string;
      friend: { id: string };
    };
    const p = duplicate.friend.id;
    const created = [
      await create(
        asha,
        duplicate.groupId,
        expense([{ userId: asha.id, amount: 100001 }], {
          method: 'equal',
          participants: [asha.id, p],
        }),
      ),
      await create(
        asha,
        duplicate.groupId,
        expense([{ userId: p, amount: 50000 }], {
          method: 'exact',
          amounts: [
            { userId: asha.id, amount: 20000 },
            { userId: p, amount: 30000 },
          ],
        }),
      ),
    ];

    await claim(bilal, asha, duplicate.groupId, p);

    for (const before of created) {
      expect((await get(asha, before.id)).groupId).toBe(real.groupId);
      await expectRoundTrip(asha, before, p, bilal.id);
    }
  });
});
