// DELETE /me end to end against a fresh database (Blueprint 4.1): the person anonymized, signed
// out everywhere, and their groups left or kept as each one's balances require.

import {
  ActivityFeed,
  ErrorEnvelope,
  FriendList,
  Group,
  GroupBalances,
  GroupList,
  InviteCreated,
  PeopleList,
  Profile,
  type SplitInput,
} from '@fairshare/contracts';
import { auth_user, auth_verification, groups, users } from '@fairshare/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
type Who = { cookie: string; id: string; email: string };

async function get<T extends z.ZodType>(who: Who, path: string, schema: T): Promise<z.output<T>> {
  const res = await ctx.call(who, 'GET', `/api/v1${path}`);
  expect(res.status, `GET ${path}`).toBe(200);
  return schema.parse(res.body);
}

async function newGroup(owner: Who, name: string, placeholders: string[] = []) {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name,
    currency: 'INR',
    members: placeholders.map((p) => ({ name: p })),
  });
  expect(res.status).toBe(201);
  return Group.parse(res.body);
}

async function join(owner: Who, groupId: string, ...people: Who[]) {
  const invite = InviteCreated.parse(
    (await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {})).body,
  );
  const token = invite.url.split('/').pop()!;
  for (const who of people) {
    expect((await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {})).status).toBe(200);
  }
}

/** `payer` paid `amount`, split equally between `people`. */
async function expense(who: Who, groupId: string, payer: string, amount: number, people: string[]) {
  const split: SplitInput = { method: 'equal', participants: people };
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, {
    id: uuidv7(),
    description: 'Dinner',
    amount,
    currency: 'INR',
    occurredOn: '2026-11-10',
    payers: [{ userId: payer, amount }],
    split,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function settle(who: Who, groupId: string, from: string, to: string, amount: number) {
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/settlements`, {
    id: uuidv7(),
    fromUserId: from,
    toUserId: to,
    amount,
    currency: 'INR',
    occurredOn: '2026-11-11',
    method: 'cash',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function befriend(me: Who, friend: Who) {
  // Friends must share a group first; then the friendship (a direct group) can be made.
  const res = await ctx.call(me, 'POST', '/api/v1/friends', { userId: friend.id });
  expect([200, 201]).toContain(res.status);
  return (res.body as { groupId: string }).groupId;
}

const deleteMe = (who: Who) =>
  ctx.request('/api/v1/me', { method: 'DELETE', cookie: who.cookie, body: { confirm: 'DELETE' } });
const memberIn = (group: Group, userId: string) => group.members.find((m) => m.user.id === userId);

describe('DELETE /me', () => {
  it('anonymizes the person, ends every session, and lets the address start afresh', async () => {
    const me = await person('asha');
    const other = await ctx.signIn(me.email); // a second device
    const [before] = await ctx.db.select().from(users).where(eq(users.id, me.id));

    const res = await deleteMe(me);

    expect(res.status).toBe(204);
    expect(res.headers.get('Clear-Site-Data')).toBe('"cookies", "storage"');
    const [after] = await ctx.db.select().from(users).where(eq(users.id, me.id));
    expect(after).toMatchObject({
      name: 'Deleted user',
      email: null,
      avatarUrl: null,
      upiVpa: null,
      authUserId: null,
    });
    expect(after!.deletedAt).toBeInstanceOf(Date);
    const authUsers = await ctx.db
      .select()
      .from(auth_user)
      .where(eq(auth_user.id, before!.authUserId!));
    expect(authUsers).toHaveLength(0);
    for (const cookie of [me.cookie, other.cookie]) {
      expect((await ctx.request('/api/v1/me', { cookie })).status).toBe(401);
    }

    // Signing in again with the same address is a new, empty account.
    const again = await ctx.signIn(me.email);
    const profile = Profile.parse(
      await (await ctx.request('/api/v1/me', { cookie: again.cookie })).json(),
    );
    expect(profile.id).not.toBe(me.id);
    expect(profile.email).toBe(me.email);
    expect((await get({ ...me, cookie: again.cookie }, '/groups', GroupList)).items).toHaveLength(
      0,
    );
  });

  it('removes a sign-in code still waiting to be used', async () => {
    const me = await person('bilal');
    expect((await ctx.sendCode(me.email)).status).toBe(200);
    const identifier = `sign-in-otp-${me.email}`;
    const pending = () =>
      ctx.db.select().from(auth_verification).where(eq(auth_verification.identifier, identifier));
    expect(await pending()).toHaveLength(1);

    expect((await deleteMe(me)).status).toBe(204);

    expect(await pending()).toHaveLength(0);
  });

  it('needs a session', async () => {
    const res = await ctx.request('/api/v1/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.parse(await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('needs {confirm: "DELETE"}, so nothing deletes an account by accident', async () => {
    const me = await person('dina');
    for (const body of [undefined, {}, { confirm: 'delete' }, { confirm: 'DELETE', extra: 1 }]) {
      const res = await ctx.request('/api/v1/me', { method: 'DELETE', cookie: me.cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await ctx.request('/api/v1/me', { cookie: me.cookie })).status).toBe(200);
  });
});

describe('groups after deleting an account', () => {
  it('leaves a settled group, handing ownership to the longest-standing member with an account', async () => {
    const me = await person('chitra');
    const [dev, esha] = [await person('dev'), await person('esha')];
    const group = await newGroup(me, 'Flat', ['Placeholder']);
    await join(me, group.id, dev, esha);

    expect((await deleteMe(me)).status).toBe(204);

    const seen = await get(dev, `/groups/${group.id}`, Group);
    expect(memberIn(seen, me.id)).toMatchObject({
      user: { name: 'Deleted user', isDeleted: true, avatarUrl: null },
      role: 'member',
    });
    expect(memberIn(seen, me.id)!.leftAt).not.toBeNull();
    expect(memberIn(seen, dev.id)!.role).toBe('owner');

    const activity = await get(dev, `/groups/${group.id}/activity`, ActivityFeed);
    expect(activity.items[0]).toMatchObject({
      verb: 'member.deleted',
      actor: { id: me.id, name: 'Deleted user', isDeleted: true },
      after: { left: true, newOwnerId: dev.id },
    });
  });

  it('stays, as Deleted user, where still owing or owed, so it can be settled', async () => {
    const me = await person('farah');
    const gita = await person('gita');
    const group = await newGroup(me, 'Trip');
    await join(me, group.id, gita);
    // Gita paid 1,000 for both: I owe her 500.
    await expense(gita, group.id, gita.id, 100_000, [me.id, gita.id]);
    const before = await get(gita, `/groups/${group.id}/balances`, GroupBalances);

    expect((await deleteMe(me)).status).toBe(204);

    const seen = await get(gita, `/groups/${group.id}`, Group);
    expect(memberIn(seen, me.id)).toMatchObject({
      user: { name: 'Deleted user', isDeleted: true },
      role: 'member',
      leftAt: null,
    });
    // I owned it; Gita does now.
    expect(memberIn(seen, gita.id)!.role).toBe('owner');
    // Balances are exactly as they were: the expenses stay.
    expect(await get(gita, `/groups/${group.id}/balances`, GroupBalances)).toEqual(before);
    const activity = await get(gita, `/groups/${group.id}/activity`, ActivityFeed);
    expect(activity.items[0]).toMatchObject({
      verb: 'member.deleted',
      after: { left: false, newOwnerId: gita.id },
    });

    // Gita records the cash I gave her, then (as owner) removes me.
    await settle(gita, group.id, me.id, gita.id, 50_000);
    const removed = await ctx.call(gita, 'DELETE', `/api/v1/groups/${group.id}/members/${me.id}`);
    expect(removed.status).toBe(204);
  });

  it('leaves a settled friendship, and keeps one with a balance', async () => {
    const me = await person('hari');
    const [ira, jay] = [await person('ira'), await person('jay')];
    const shared = await newGroup(me, 'Shared');
    await join(me, shared.id, ira, jay);
    const settled = await befriend(me, ira);
    const owing = await befriend(me, jay);
    await expense(jay, owing, jay.id, 60_000, [me.id, jay.id]);

    expect((await deleteMe(me)).status).toBe(204);

    const settledGroup = await get(ira, `/groups/${settled}`, Group);
    expect(memberIn(settledGroup, me.id)!.leftAt).not.toBeNull();
    const owingGroup = await get(jay, `/groups/${owing}`, Group);
    expect(memberIn(owingGroup, me.id)!.leftAt).toBeNull();

    // Jay still sees what Deleted user owes him.
    const jayFriends = await get(jay, '/friends', FriendList);
    expect(jayFriends.items.find((f) => f.user.id === me.id)).toMatchObject({
      user: { name: 'Deleted user', isDeleted: true },
      balances: [{ amount: 30_000, currency: 'INR' }],
    });
    // Ira and I shared nothing any more, so I'm not on her list.
    const iraFriends = await get(ira, '/friends', FriendList);
    expect(iraFriends.items.find((f) => f.user.id === me.id)).toBeUndefined();
  });

  it('closes a group nobody with an account could open any more', async () => {
    const me = await person('kiran');
    const group = await newGroup(me, 'Solo', ['Only a placeholder']);

    expect((await deleteMe(me)).status).toBe(204);

    const [row] = await ctx.db.select().from(groups).where(eq(groups.id, group.id));
    expect(row!.deletedAt).toBeInstanceOf(Date);
  });

  it('is never offered as someone to add, and can’t be added', async () => {
    const me = await person('lata');
    const mohan = await person('mohan');
    const group = await newGroup(me, 'Office');
    await join(me, group.id, mohan);
    await expense(mohan, group.id, mohan.id, 20_000, [me.id, mohan.id]);
    expect((await deleteMe(me)).status).toBe(204);

    const people = await get(mohan, '/people', PeopleList);
    expect(people.items.map((p) => p.id)).not.toContain(me.id);
    const other = await newGroup(mohan, 'Other');
    const added = await ctx.call(mohan, 'POST', `/api/v1/groups/${other.id}/members`, {
      userId: me.id,
    });
    expect(added.status).toBe(400);
  });

  it('is never made owner when the owner leaves', async () => {
    const owner = await person('nita');
    const me = await person('om');
    const later = await person('priya');
    const group = await newGroup(owner, 'Club');
    await join(owner, group.id, me);
    await join(owner, group.id, later);
    // I owe Priya, so I stay in the group after deleting my account.
    await expense(later, group.id, later.id, 40_000, [me.id, later.id]);
    expect((await deleteMe(me)).status).toBe(204);

    // The owner leaves: I joined before Priya, but a deleted account can't own a group.
    expect((await ctx.call(owner, 'DELETE', `/api/v1/groups/${group.id}/members/me`)).status).toBe(
      204,
    );

    const seen = await get(later, `/groups/${group.id}`, Group);
    expect(memberIn(seen, later.id)!.role).toBe('owner');
  });
});
