// Groups and members, against a fresh database.

import { ErrorEnvelope, Group, GroupList, Member } from '@fairshare/contracts';
import { activityLog, groups, users } from '@fairshare/db';
import { insertTransaction } from '@fairshare/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;

async function createGroup(owner: { cookie: string }, extra: Record<string, unknown> = {}) {
  const id = uuidv7();
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id,
    name: 'Goa Trip',
    currency: 'INR',
    ...extra,
  });
  expect(res.status).toBe(201);
  return Group.parse(res.body);
}

/** An expense in the group: `payer` paid `amount`, split equally between payer and `other`. */
async function expense(groupId: string, payer: string, other: string, amount = 1000) {
  await insertTransaction(ctx.db, {
    groupId,
    createdBy: payer,
    amount,
    payers: [{ userId: payer, amount }],
    shares: [
      { userId: payer, amount: amount / 2 },
      { userId: other, amount: amount / 2 },
    ],
  });
}

describe('POST /groups', () => {
  it('creates the group with me as owner and the people listed, and records it', async () => {
    const asha = await person('asha');

    const group = await createGroup(asha, {
      emoji: '🏖️',
      members: [{ name: 'Bilal' }, { name: 'Chitra', email: 'chitra@example.com' }],
    });

    expect(group).toMatchObject({ kind: 'group', name: 'Goa Trip', emoji: '🏖️', myRole: 'owner' });
    expect(group.members.map((m) => [m.user.name, m.role, m.user.isPlaceholder])).toEqual([
      ['Asha', 'owner', false],
      ['Bilal', 'member', true],
      ['Chitra', 'member', true],
    ]);
    const [chitra] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, group.members[2]!.user.id));
    expect(chitra).toMatchObject({ email: 'chitra@example.com', createdBy: asha.id });
    const log = await ctx.db.select().from(activityLog).where(eq(activityLog.groupId, group.id));
    expect(log.map((e) => e.verb)).toEqual(['group.created', 'member.added', 'member.added']);
  });

  it('adds people I share a group with by ID, and refuses anyone else', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const stranger = await person('stranger');
    const first = await createGroup(asha);
    await join(first.id, asha, bilal);

    const second = await createGroup(asha, { members: [{ userId: bilal.id }] });
    expect(second.members.map((m) => m.user.id)).toEqual([asha.id, bilal.id]);

    const res = await ctx.call(asha, 'POST', '/api/v1/groups', {
      id: uuidv7(),
      name: 'Nope',
      currency: 'INR',
      members: [{ name: 'Fine' }, { userId: stranger.id }],
    });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.parse(res.body).error.details).toEqual({
      issues: [
        {
          path: ['members', 1, 'userId'],
          message: 'Not someone you share a group with',
          code: 'custom',
        },
      ],
    });
  });

  it('replays a retry with the same ID (200), and refuses an ID that is someone else’s', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const body = { id: uuidv7(), name: 'Flat', currency: 'INR', members: [{ name: 'X' }] };

    const first = await ctx.call(asha, 'POST', '/api/v1/groups', body);
    const again = await ctx.call(asha, 'POST', '/api/v1/groups', body);
    const theirs = await ctx.call(bilal, 'POST', '/api/v1/groups', body);

    expect([first.status, again.status, theirs.status]).toEqual([201, 200, 409]);
    expect(Group.parse(again.body)).toEqual(Group.parse(first.body));
    expect(Group.parse(again.body).members).toHaveLength(2);
    expect(code(theirs.body)).toBe('ID_CONFLICT');
  });

  it('rejects an unsupported currency', async () => {
    const asha = await person('asha');
    const res = await ctx.call(asha, 'POST', '/api/v1/groups', {
      id: uuidv7(),
      name: 'X',
      currency: 'XXX',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /groups', () => {
  it('lists my regular groups with my net per currency, newest first', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const older = await createGroup(asha, { name: 'Older' });
    await ctx.call(asha, 'POST', `/api/v1/groups/${older.id}/members`, { name: 'Bilal' });
    const newer = await createGroup(asha, { name: 'Newer', members: [{ name: 'Dev' }] });
    const dev = newer.members[1]!.user.id;
    await expense(newer.id, asha.id, dev, 1000); // Asha is owed 500
    await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Not a group' });

    const res = await ctx.call(asha, 'GET', '/api/v1/groups');

    const { items } = GroupList.parse(res.body);
    expect(items.map((g) => [g.name, g.myNet])).toEqual([
      ['Newer', [{ amount: 500, currency: 'INR' }]],
      ['Older', []],
    ]);
    expect((await ctx.call(bilal, 'GET', '/api/v1/groups')).body).toEqual({ items: [] });
  });
});

describe('PATCH /groups/:groupId', () => {
  it('renames and changes the emoji, recording each kind of change', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { emoji: '🏖️' });

    const res = await ctx.call(asha, 'PATCH', `/api/v1/groups/${group.id}`, {
      name: 'Goa 2026',
      emoji: null,
    });

    expect(Group.parse(res.body)).toMatchObject({ name: 'Goa 2026', emoji: null });
    const log = await ctx.db.select().from(activityLog).where(eq(activityLog.groupId, group.id));
    expect(log.slice(-2).map((e) => [e.verb, e.before, e.after])).toEqual([
      ['group.renamed', { name: 'Goa Trip' }, { name: 'Goa 2026' }],
      ['group.updated', { emoji: '🏖️' }, { emoji: null }],
    ]);
  });

  it('records nothing when nothing changes', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha);

    await ctx.call(asha, 'PATCH', `/api/v1/groups/${group.id}`, { name: 'Goa Trip' });

    const log = await ctx.db.select().from(activityLog).where(eq(activityLog.groupId, group.id));
    expect(log.map((e) => e.verb)).toEqual(['group.created']);
  });

  it('changes the currency only while the group has no transactions', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { members: [{ name: 'Bilal' }] });

    const free = await ctx.call(asha, 'PATCH', `/api/v1/groups/${group.id}`, { currency: 'USD' });
    expect(Group.parse(free.body).currency).toBe('USD');

    await expense(group.id, asha.id, group.members[1]!.user.id);
    const locked = await ctx.call(asha, 'PATCH', `/api/v1/groups/${group.id}`, { currency: 'EUR' });
    expect(locked.status).toBe(409);
    expect(code(locked.body)).toBe('CURRENCY_LOCKED');
  });
});

describe('DELETE /groups/:groupId', () => {
  it('lets the owner delete a settled group, which then disappears', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha);

    expect((await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}`)).status).toBe(204);

    expect((await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}`)).status).toBe(404);
    const [row] = await ctx.db.select().from(groups).where(eq(groups.id, group.id));
    expect(row!.deletedAt).toBeInstanceOf(Date);
  });

  it('refuses while anyone has a balance', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { members: [{ name: 'Bilal' }] });
    await expense(group.id, asha.id, group.members[1]!.user.id);

    const res = await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}`);

    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('BALANCE_NOT_ZERO');
  });
});

describe('members', () => {
  it('adds a placeholder (201) and refuses someone already in the group', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha);

    const added = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, {
      name: 'Dev',
    });
    expect(added.status).toBe(201);
    expect(Member.parse(added.body)).toMatchObject({
      user: { name: 'Dev', isPlaceholder: true },
      role: 'member',
      leftAt: null,
    });

    const self = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, {
      userId: asha.id,
    });
    expect(self.status).toBe(409);
    expect(code(self.body)).toBe('ALREADY_MEMBER');
  });

  it('lets the owner remove a settled member, and only the owner', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { members: [{ name: 'Bilal' }, { name: 'Chitra' }] });
    const [bilal, chitra] = group.members.slice(1).map((m) => m.user.id);

    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${bilal}`)).status,
    ).toBe(204);
    const after = Group.parse((await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}`)).body);
    expect(after.members.find((m) => m.user.id === bilal)?.leftAt).not.toBeNull();

    await expense(group.id, asha.id, chitra!);
    const owing = await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${chitra}`);
    expect(owing.status).toBe(409);
    expect(code(owing.body)).toBe('BALANCE_NOT_ZERO');
  });

  it('brings back someone who left, through an invite or by ID', async () => {
    const asha = await person('asha');
    const bilal = await person('bilal');
    const group = await createGroup(asha);
    const elsewhere = await createGroup(asha); // keeps Asha and Bilal "people who know each other"
    await join(group.id, asha, bilal);
    await join(elsewhere.id, asha, bilal);

    await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${bilal.id}`);
    const byId = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, {
      userId: bilal.id,
    });
    expect(byId.status).toBe(201);
    expect(Member.parse(byId.body)).toMatchObject({ role: 'member', leftAt: null });

    await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/me`);
    await join(group.id, asha, bilal);
    const seen = Group.parse((await ctx.call(bilal, 'GET', `/api/v1/groups/${group.id}`)).body);
    expect(seen.members.filter((m) => m.user.id === bilal.id)).toHaveLength(1);
  });

  it('refuses to add by ID someone I share no group with', async () => {
    const asha = await person('asha');
    const stranger = await person('stranger');
    const group = await createGroup(asha);

    const res = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, {
      userId: stranger.id,
    });

    expect(res.status).toBe(400);
  });
});

describe('leaving', () => {
  it('lets a settled member leave; the group then 404s for them', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha);
    const bilal = await person('bilal');
    await join(group.id, asha, bilal);

    const res = await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/me`);

    expect(res.status).toBe(204);
    expect((await ctx.call(bilal, 'GET', `/api/v1/groups/${group.id}`)).status).toBe(404);
  });

  it('refuses while my balance isn’t zero', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha);
    const bilal = await person('bilal');
    await join(group.id, asha, bilal);
    await expense(group.id, asha.id, bilal.id);

    const res = await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/me`);

    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('BALANCE_NOT_ZERO');
  });

  it('passes ownership to the longest-standing member with an account, never a placeholder', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { members: [{ name: 'Placeholder' }] });
    const bilal = await person('bilal');
    const chitra = await person('chitra');
    await join(group.id, asha, bilal);
    await join(group.id, asha, chitra);

    await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/me`);

    const seen = Group.parse((await ctx.call(bilal, 'GET', `/api/v1/groups/${group.id}`)).body);
    expect(seen.myRole).toBe('owner');
    expect(seen.members.filter((m) => m.role === 'owner').map((m) => m.user.id)).toEqual([
      bilal.id,
    ]);
    const log = await ctx.db.select().from(activityLog).where(eq(activityLog.groupId, group.id));
    expect(log.at(-1)).toMatchObject({
      verb: 'member.left',
      actorId: asha.id,
      after: { newOwnerId: bilal.id },
    });
  });

  it('closes the group when the last member with an account leaves', async () => {
    const asha = await person('asha');
    const group = await createGroup(asha, { members: [{ name: 'Placeholder' }] });

    expect((await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/me`)).status).toBe(
      204,
    );

    const [row] = await ctx.db.select().from(groups).where(eq(groups.id, group.id));
    expect(row!.deletedAt).toBeInstanceOf(Date);
  });
});

describe('friendships (direct groups)', () => {
  it('can’t be renamed, deleted, left or given more members', async () => {
    const asha = await person('asha');
    const { body } = await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' });
    const groupId = (body as { groupId: string }).groupId;

    for (const [method, path, payload] of [
      ['PATCH', `/api/v1/groups/${groupId}`, { name: 'X' }],
      ['DELETE', `/api/v1/groups/${groupId}`, undefined],
      ['DELETE', `/api/v1/groups/${groupId}/members/me`, undefined],
      ['POST', `/api/v1/groups/${groupId}/members`, { name: 'Third' }],
      ['POST', `/api/v1/groups/${groupId}/invites`, {}],
    ] as const) {
      const res = await ctx.call(asha, method, path, payload);
      expect(res.status, `${method} ${path}`).toBe(422);
      expect(code(res.body)).toBe('CANNOT_MODIFY_DIRECT_GROUP');
    }
    const group = Group.parse((await ctx.call(asha, 'GET', `/api/v1/groups/${groupId}`)).body);
    expect(group).toMatchObject({ kind: 'direct', name: null, myRole: 'member' });
  });
});

/** Puts `who` into the group through a plain invite, as the app would. */
async function join(groupId: string, owner: { cookie: string }, who: { cookie: string }) {
  const invite = await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {});
  const token = (invite.body as { url: string }).url.split('/').pop()!;
  const res = await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {});
  expect(res.status).toBe(200);
}
