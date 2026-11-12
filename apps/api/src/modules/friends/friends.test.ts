// Friends (direct groups), the people list, and claims through a matching email address.

import {
  AddFriendResponse,
  ClaimList,
  ClaimResponse,
  ErrorEnvelope,
  FriendList,
  Group,
  InviteCreated,
  PeopleList,
} from '@fairshare/contracts';
import { directPairs, groups, users } from '@fairshare/db';
import { insertTransaction } from '@fairshare/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
type Who = { cookie: string; id: string };

async function groupWith(owner: Who, members: Record<string, unknown>[] = []) {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name: 'Goa Trip',
    currency: 'INR',
    members,
  });
  return Group.parse(res.body);
}

async function join(owner: Who, groupId: string, who: Who) {
  const invite = await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {});
  const token = InviteCreated.parse(invite.body).url.split('/').pop()!;
  expect((await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {})).status).toBe(200);
}

describe('POST /friends', () => {
  it('makes a placeholder friend (201): a two-person group in my currency', async () => {
    const asha = await person('asha');
    await ctx.call(asha, 'PATCH', '/api/v1/me', { defaultCurrency: 'GBP' });

    const res = await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' });

    expect(res.status).toBe(201);
    const { groupId, friend } = AddFriendResponse.parse(res.body);
    expect(friend).toMatchObject({ name: 'Bilal', isPlaceholder: true });
    const group = Group.parse((await ctx.call(asha, 'GET', `/api/v1/groups/${groupId}`)).body);
    expect(group).toMatchObject({ kind: 'direct', name: null, currency: 'GBP' });
    expect(group.members.map((m) => m.role)).toEqual(['member', 'member']);
  });

  it('finds the existing friendship with someone I know (201, then 200)', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    await join(asha, (await groupWith(asha)).id, bilal);

    const first = await ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id });
    const again = await ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id });
    const fromBilal = await ctx.call(bilal, 'POST', '/api/v1/friends', {
      userId: asha.id.toUpperCase(),
    });

    expect([first.status, again.status, fromBilal.status]).toEqual([201, 200, 200]);
    const ids = [first, again, fromBilal].map((r) => AddFriendResponse.parse(r.body).groupId);
    expect(new Set(ids).size).toBe(1);
  });

  it('creates exactly one friendship when both add each other at the same moment', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    await join(asha, (await groupWith(asha)).id, bilal);

    const results = await Promise.all([
      ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id }),
      ctx.call(bilal, 'POST', '/api/v1/friends', { userId: asha.id }),
      ctx.call(asha, 'POST', '/api/v1/friends', { userId: bilal.id }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => AddFriendResponse.parse(r.body).groupId)).size).toBe(1);
    const [low, high] = [asha.id, bilal.id].sort();
    const pairs = await ctx.db
      .select()
      .from(directPairs)
      .where(and(eq(directPairs.userLow, low!), eq(directPairs.userHigh, high!)));
    expect(pairs).toHaveLength(1);
    // The attempts that lost rolled back completely: no stray friendship group is left.
    const directGroups = await ctx.db
      .select()
      .from(groups)
      .where(and(eq(groups.kind, 'direct'), inArray(groups.createdBy, [asha.id, bilal.id])));
    expect(directGroups).toHaveLength(1);
  });

  it('refuses myself and people I share no group with', async () => {
    const asha = await person('asha');
    const stranger = await person('stranger');

    for (const userId of [asha.id, stranger.id]) {
      const res = await ctx.call(asha, 'POST', '/api/v1/friends', { userId });
      expect(res.status).toBe(400);
      expect(ErrorEnvelope.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('GET /friends', () => {
  it('lists my friends and anyone I have a balance with, balances first', async () => {
    const asha = await person('asha');
    const zed = await person('zed');
    await join(asha, (await groupWith(asha)).id, zed);
    await ctx.call(asha, 'POST', '/api/v1/friends', { userId: zed.id }); // a settled friend
    const trip = await groupWith(asha, [{ name: 'Bilal' }, { name: 'Chitra' }]);
    const [bilal, chitra] = trip.members.slice(1).map((m) => m.user.id);
    // Asha paid 900 for all three: Bilal and Chitra owe her 300 each.
    await insertTransaction(ctx.db, {
      groupId: trip.id,
      createdBy: asha.id,
      amount: 900,
      payers: [{ userId: asha.id, amount: 900 }],
      shares: [
        { userId: asha.id, amount: 300 },
        { userId: bilal!, amount: 300 },
        { userId: chitra!, amount: 300 },
      ],
    });

    const { items } = FriendList.parse((await ctx.call(asha, 'GET', '/api/v1/friends')).body);

    expect(items.map((f) => [f.user.name, f.balances, f.directGroupId !== null])).toEqual([
      ['Bilal', [{ amount: 300, currency: 'INR' }], false],
      ['Chitra', [{ amount: 300, currency: 'INR' }], false],
      ['Zed', [], true],
    ]);
  });

  it('shows a debt from my side as negative', async () => {
    const asha = await person('asha');
    const { body } = await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' });
    const { groupId, friend } = AddFriendResponse.parse(body);
    await insertTransaction(ctx.db, {
      groupId,
      createdBy: asha.id,
      amount: 500,
      payers: [{ userId: friend.id, amount: 500 }],
      shares: [{ userId: asha.id, amount: 500 }],
    });

    const { items } = FriendList.parse((await ctx.call(asha, 'GET', '/api/v1/friends')).body);

    expect(items).toEqual([
      { user: friend, balances: [{ amount: -500, currency: 'INR' }], directGroupId: groupId },
    ]);
  });
});

describe('GET /people', () => {
  it('lists everyone I share an active group with, once, by name', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const a = await groupWith(asha, [{ name: 'Chitra' }]);
    const b = await groupWith(asha, [{ name: 'Anand' }]);
    await join(asha, a.id, bilal);
    await join(asha, b.id, bilal);
    const gone = await groupWith(asha, [{ name: 'Gone' }]);
    await ctx.call(asha, 'DELETE', `/api/v1/groups/${gone.id}`);

    const { items } = PeopleList.parse((await ctx.call(asha, 'GET', '/api/v1/people')).body);

    expect(items.map((p) => p.name)).toEqual(['Anand', 'Bilal', 'Chitra']);
  });
});

describe('claims through a matching email', () => {
  it('offers a placeholder made with my address, case-insensitively, and claims it', async () => {
    const asha = await person('asha');
    const email = `bilal+${++n}@example.com`;
    const group = await groupWith(asha, [{ name: 'Bilal', email: email.toUpperCase() }]);
    const bilal = await ctx.person(email);

    const list = ClaimList.parse((await ctx.call(bilal, 'GET', '/api/v1/claims')).body);
    expect(list.items).toEqual([
      {
        placeholder: { id: group.members[1]!.user.id, name: 'Bilal' },
        addedBy: { name: 'Asha' },
        groups: [{ id: group.id, kind: 'group', name: 'Goa Trip', emoji: null }],
      },
    ]);

    const res = await ctx.call(bilal, 'POST', `/api/v1/claims/${list.items[0]!.placeholder.id}`);
    expect(ClaimResponse.parse(res.body)).toEqual({ groupIds: [group.id] });
    expect((await ctx.call(bilal, 'GET', '/api/v1/claims')).body).toEqual({ items: [] });
    expect((await ctx.call(bilal, 'GET', `/api/v1/groups/${group.id}`)).status).toBe(200);
  });

  it('lets me dismiss one, which removes the email hint', async () => {
    const asha = await person('asha');
    const email = `chitra+${++n}@example.com`;
    const group = await groupWith(asha, [{ name: 'Chitra', email }]);
    const chitra = await ctx.person(email);
    const placeholder = group.members[1]!.user.id;

    expect((await ctx.call(chitra, 'DELETE', `/api/v1/claims/${placeholder}`)).status).toBe(204);

    expect((await ctx.call(chitra, 'GET', '/api/v1/claims')).body).toEqual({ items: [] });
    const [row] = await ctx.db.select().from(users).where(eq(users.id, placeholder));
    expect(row!.email).toBeNull();
  });

  it('never lets anyone else claim or dismiss it', async () => {
    const asha = await person('asha');
    const group = await groupWith(asha, [{ name: 'Dev', email: `dev+${++n}@example.com` }]);
    const placeholder = group.members[1]!.user.id;
    const other = await person('other');

    expect((await ctx.call(other, 'POST', `/api/v1/claims/${placeholder}`)).status).toBe(404);
    expect((await ctx.call(other, 'DELETE', `/api/v1/claims/${placeholder}`)).status).toBe(404);
    expect((await ctx.call(asha, 'POST', `/api/v1/claims/${placeholder}`)).status).toBe(404);
  });

  it('leaves out a placeholder in a group I’m already in (it would conflict)', async () => {
    const email = `esha+${++n}@example.com`;
    const esha = await ctx.person(email);
    const group = await groupWith(esha, [{ name: 'Esha again', email }]);

    expect(group.members).toHaveLength(2);
    expect((await ctx.call(esha, 'GET', '/api/v1/claims')).body).toEqual({ items: [] });
  });

  it('never reveals whether an address has an account: adding by email always makes a placeholder', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');

    const group = await groupWith(asha, [{ name: 'Bilal', email: bilal.email }]);

    expect(group.members[1]!.user).toMatchObject({ name: 'Bilal', isPlaceholder: true });
    expect(group.members.map((m) => m.user.id)).not.toContain(bilal.id);
  });
});
