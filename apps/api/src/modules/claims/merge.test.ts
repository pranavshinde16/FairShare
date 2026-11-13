// Claiming a placeholder (Blueprint 5.3): every case the plan lists, through the invite route.

import { AcceptInviteResponse, ErrorEnvelope, Group, InviteCreated } from '@fairshare/contracts';
import {
  activityLog,
  directPairs,
  groups,
  ledger,
  transactionPayers,
  transactions,
  transactionShares,
  users,
} from '@fairshare/db';
import { insertTransaction } from '@fairshare/db/testing';
import { and, asc, eq, or, sql } from 'drizzle-orm';
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

const claim = (who: Who, token: string, placeholderId: string) =>
  ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, { claimPlaceholderId: placeholderId });

/** owner paid `amount`, split equally with `other`. */
const expense = (groupId: string, owner: string, other: string, amount = 1000) =>
  insertTransaction(ctx.db, {
    groupId,
    createdBy: owner,
    amount,
    payers: [{ userId: owner, amount }],
    shares: [
      { userId: owner, amount: amount / 2 },
      { userId: other, amount: amount / 2 },
    ],
  });

async function nets(groupId: string) {
  const rows = await ctx.db
    .select({ userId: ledger.userId, net: sql<string>`sum(${ledger.amount})` })
    .from(ledger)
    .where(eq(ledger.groupId, groupId))
    .groupBy(ledger.userId);
  return Object.fromEntries(rows.map((r) => [r.userId, Number(r.net)]));
}

describe('claiming as a new user', () => {
  it('moves the placeholder’s membership, payments and shares to them', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const paidByPlaceholder = uuidv7();
    await expense(group.id, asha.id, placeholder);
    await insertTransaction(ctx.db, {
      id: paidByPlaceholder,
      groupId: group.id,
      createdBy: asha.id,
      amount: 300,
      payers: [{ userId: placeholder, amount: 300 }],
      shares: [{ userId: asha.id, amount: 300 }],
    });
    const bilal = await person('bilal');

    const res = await claim(bilal, await tokenFor(asha, group.id, placeholder), placeholder);

    expect(AcceptInviteResponse.parse(res.body)).toEqual({ groupId: group.id });
    expect(await nets(group.id)).toEqual({ [asha.id]: 200, [bilal.id]: -200 });
    const leftovers = await ctx.db
      .select()
      .from(transactionPayers)
      .where(eq(transactionPayers.userId, placeholder));
    expect(leftovers).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(transactionShares)
        .where(eq(transactionShares.userId, placeholder)),
    ).toHaveLength(0);
    const [p] = await ctx.db.select().from(users).where(eq(users.id, placeholder));
    expect(p).toMatchObject({ mergedInto: bilal.id, isPlaceholder: true });
  });

  it('keeps the activity history as written, and records who claimed whom', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const bilal = await person('bilal');

    await claim(bilal, await tokenFor(asha, group.id, placeholder), placeholder);

    const log = await ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.groupId, group.id))
      .orderBy(asc(activityLog.id));
    // The append-only log still names the placeholder in the old entry (resolved at read time).
    expect(log.find((e) => e.verb === 'member.added')!.targetUser).toBe(placeholder);
    expect(log.at(-1)).toMatchObject({
      verb: 'member.claimed',
      actorId: bilal.id,
      targetUser: placeholder,
      after: { placeholderId: placeholder, placeholderName: 'Bilal' },
    });
  });
});

describe('claiming as an existing user', () => {
  it('works alongside their other groups, which are untouched', async () => {
    const bilal = await person('bilal');
    const own = await groupWith(bilal, ['Someone']);
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;

    const res = await claim(bilal, await tokenFor(asha, group.id, placeholder), placeholder);

    expect(res.status).toBe(200);
    const mine = (await ctx.call(bilal, 'GET', '/api/v1/groups')).body as {
      items: { id: string }[];
    };
    expect(mine.items.map((g) => g.id).sort()).toEqual([own.id, group.id].sort());
  });
});

describe('conflicts', () => {
  it('refuses when the claimer is already in the group, and changes nothing', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Asha again']);
    const placeholder = group.members[1]!.user.id;

    const res = await claim(asha, await tokenFor(asha, group.id), placeholder);

    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('MERGE_CONFLICT');
    const [p] = await ctx.db.select().from(users).where(eq(users.id, placeholder));
    expect(p!.mergedInto).toBeNull();
  });

  it('refuses when the claimer was in the group and left (plan correction)', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const token = await tokenFor(asha, group.id);
    await ctx.call(bilal, 'POST', `/api/v1/invites/${token}/accept`, {});
    await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/me`);

    const res = await claim(bilal, token, placeholder);

    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('MERGE_CONFLICT');
  });

  it('lets only one of two people claiming the same placeholder at once succeed', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, ['Bilal']);
    const placeholder = group.members[1]!.user.id;
    const token = await tokenFor(asha, group.id);
    const [first, second] = await Promise.all([person('first'), person('second')]);

    const results = await Promise.all([
      claim(first, token, placeholder),
      claim(second, token, placeholder),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
  });
});

describe('a placeholder in two groups', () => {
  it('can be claimed by only one person, even through two groups’ invites at once', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    const placeholder = goa.members[1]!.user.id;
    const flat = await groupWith(asha, []);
    await ctx.call(asha, 'POST', `/api/v1/groups/${flat.id}/members`, { userId: placeholder });
    const [viaGoa, viaFlat] = await Promise.all([tokenFor(asha, goa.id), tokenFor(asha, flat.id)]);
    const [first, second] = await Promise.all([person('first'), person('second')]);
    // Open the pool's connections first, so the two claims really overlap.
    await Promise.all(Array.from({ length: 5 }, () => ctx.pool.query('SELECT pg_sleep(0.05)')));

    const results = await Promise.all([
      claim(first, viaGoa, placeholder),
      claim(second, viaFlat, placeholder),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const [p] = await ctx.db.select().from(users).where(eq(users.id, placeholder));
    const winner = results[0].status === 200 ? first : second;
    expect(p!.mergedInto).toBe(winner.id);
  });

  it('is claimed in both at once', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    const placeholder = goa.members[1]!.user.id;
    const flat = await groupWith(asha, []);
    await ctx.call(asha, 'POST', `/api/v1/groups/${flat.id}/members`, { userId: placeholder });
    const bilal = await person('bilal');

    await claim(bilal, await tokenFor(asha, goa.id, placeholder), placeholder);

    for (const groupId of [goa.id, flat.id]) {
      const group = Group.parse((await ctx.call(bilal, 'GET', `/api/v1/groups/${groupId}`)).body);
      expect(group.members.map((m) => m.user.id)).toContain(bilal.id);
      expect(group.members.map((m) => m.user.id)).not.toContain(placeholder);
    }
  });
});

describe('friendships', () => {
  async function placeholderFriend(owner: Who) {
    const res = await ctx.call(owner, 'POST', '/api/v1/friends', { name: 'Bilal' });
    return res.body as { groupId: string; friend: { id: string } };
  }

  it('become the claimer’s own when they weren’t friends yet', async () => {
    const asha = await person('asha');
    const { groupId, friend } = await placeholderFriend(asha);
    const bilal = await person('bilal');

    const res = await claim(bilal, await tokenFor(asha, groupId, friend.id), friend.id);

    expect(AcceptInviteResponse.parse(res.body)).toEqual({ groupId });
    const pairs = await ctx.db.select().from(directPairs).where(eq(directPairs.groupId, groupId));
    expect(pairs).toEqual([
      {
        userLow: [asha.id, bilal.id].sort()[0],
        userHigh: [asha.id, bilal.id].sort()[1],
        groupId,
      },
    ]);
  });

  it('merge into the friendship the claimer already had, history included', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    // Asha and Bilal already share a group, and are friends.
    const shared = await groupWith(asha, []);
    await ctx.call(bilal, 'POST', `/api/v1/invites/${await tokenFor(asha, shared.id)}/accept`, {});
    const real = (await ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id })).body as {
      groupId: string;
    };
    await expense(real.groupId, asha.id, bilal.id, 400); // Bilal owes 200 here
    // Asha also made a placeholder "Bilal" as a friend and logged an expense with it.
    const duplicate = await placeholderFriend(asha);
    await expense(duplicate.groupId, asha.id, duplicate.friend.id, 1000); // and 500 here

    const res = await claim(
      bilal,
      await tokenFor(asha, duplicate.groupId, duplicate.friend.id),
      duplicate.friend.id,
    );

    expect(AcceptInviteResponse.parse(res.body)).toEqual({ groupId: real.groupId });
    expect(await nets(real.groupId)).toEqual({ [asha.id]: 700, [bilal.id]: -700 });
    const moved = await ctx.db
      .select()
      .from(transactions)
      .where(eq(transactions.groupId, duplicate.groupId));
    expect(moved).toHaveLength(0);
    const [old] = await ctx.db.select().from(groups).where(eq(groups.id, duplicate.groupId));
    expect(old!.deletedAt).toBeInstanceOf(Date);
    const pairs = await ctx.db
      .select()
      .from(directPairs)
      .where(
        or(
          eq(directPairs.groupId, duplicate.groupId),
          and(eq(directPairs.userLow, duplicate.friend.id)),
          eq(directPairs.userHigh, duplicate.friend.id),
        ),
      );
    expect(pairs).toHaveLength(0);
    expect((await ctx.call(bilal, 'GET', `/api/v1/groups/${duplicate.groupId}`)).status).toBe(404);
  });

  it('refuse a claimer who is the other person in that friendship', async () => {
    const asha = await person('asha');
    const { groupId, friend } = await placeholderFriend(asha);

    const res = await claim(asha, await tokenFor(asha, groupId, friend.id), friend.id);

    expect(code(res.body)).toBe('MERGE_CONFLICT');
  });
});
