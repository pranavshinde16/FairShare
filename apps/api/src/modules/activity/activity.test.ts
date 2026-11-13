// The activity feeds against a fresh database (Blueprint 4.9 "Feeds", 6.3 "Activity", I11): an
// entry for every kind of change, who sees what, paging, the unread count, and claimed
// placeholders shown as whoever claimed them.

import {
  ACTIVITY_VERBS,
  ActivityFeed,
  AddFriendResponse,
  ErrorEnvelope,
  Group,
  InviteCreated,
  Transaction,
  TransactionHistory,
  type ActivityEntry,
  type CreateExpense,
} from '@fairshare/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';
import { encodeCursor } from './service';

const ctx = await integrationApp({ clock: () => new Date('2026-11-12T10:00:00Z') });
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
type Who = { cookie: string; id: string };

async function feedOf(who: Who, query = '') {
  const res = await ctx.call(who, 'GET', `/api/v1/activity${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ActivityFeed.parse(res.body);
}
async function groupFeedOf(who: Who, groupId: string, query = '') {
  const res = await ctx.call(who, 'GET', `/api/v1/groups/${groupId}/activity${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ActivityFeed.parse(res.body);
}
/** Every entry of a feed, all pages. */
async function allOf(who: Who, groupId?: string): Promise<ActivityEntry[]> {
  const items: ActivityEntry[] = [];
  let cursor: string | null = null;
  do {
    const query = `?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const page: ActivityFeed = groupId
      ? await groupFeedOf(who, groupId, query)
      : await feedOf(who, query);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
const verbs = (items: ActivityEntry[]) => items.map((e) => e.verb);
const seen = async (who: Who) =>
  expect((await ctx.call(who, 'POST', '/api/v1/activity/seen')).status).toBe(204);

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

async function invite(owner: Who, groupId: string, targetPlaceholderId?: string) {
  const res = await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {
    ...(targetPlaceholderId && { targetPlaceholderId }),
  });
  expect(res.status).toBe(201);
  const created = InviteCreated.parse(res.body);
  return { ...created, token: created.url.split('/').pop()! };
}

async function join(owner: Who, groupId: string, who: Who, claimPlaceholderId?: string) {
  const { token } = await invite(owner, groupId);
  const res = await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {
    ...(claimPlaceholderId && { claimPlaceholderId }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

function expenseBody(payer: string, participants: string[], amount = 1000): CreateExpense {
  return {
    id: uuidv7(),
    description: 'Dinner',
    amount,
    currency: 'INR',
    occurredOn: '2026-11-10',
    payers: [{ userId: payer, amount }],
    split: { method: 'equal', participants },
  };
}

async function expense(who: Who, groupId: string, body: CreateExpense) {
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Transaction.parse(res.body);
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
  expect(res.status, path).toBe(200);
  return res.json();
}

describe('an entry for every kind of change (I11)', () => {
  it('records each verb, in the group’s feed, in order', async () => {
    const [asha, bilal, chitra] = await Promise.all([
      person('asha'),
      person('bilal'),
      person('chitra'),
    ]);
    // group.created, member.added (placeholder Chitra)
    const group = await newGroup(asha, 'Goa', ['Chitra']);
    const chitraPlaceholder = group.members[1]!.user.id;
    // invite.created, member.added (Bilal joins)
    await join(asha, group.id, bilal);
    // group.renamed, group.updated
    expect(
      (
        await ctx.call(asha, 'PATCH', `/api/v1/groups/${group.id}`, {
          name: 'Goa 2026',
          emoji: '🏖️',
        })
      ).status,
    ).toBe(200);
    // member.added, member.removed (placeholder Dev)
    const dev = (
      await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/members`, { name: 'Dev' })
    ).body as { user: { id: string } };
    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${dev.user.id}`)).status,
    ).toBe(204);
    // invite.created (aimed at Chitra), invite.revoked
    const aimed = await invite(asha, group.id, chitraPlaceholder);
    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/invites/${aimed.id}`)).status,
    ).toBe(204);
    // transaction.created, .updated, .deleted, .restored: an expense
    const body = expenseBody(asha.id, [asha.id, bilal.id]);
    const tx = await expense(asha, group.id, body);
    const { id: _id, ...update } = {
      ...body,
      amount: 2000,
      payers: [{ userId: asha.id, amount: 2000 }],
    };
    await write(bilal, 'PUT', `/api/v1/transactions/${tx.id}`, 1, update);
    await write(bilal, 'DELETE', `/api/v1/transactions/${tx.id}`, 2);
    await write(asha, 'POST', `/api/v1/transactions/${tx.id}/restore`, 3);
    // … and a settlement: Bilal pays back his ₹10
    const payment = {
      fromUserId: bilal.id,
      toUserId: asha.id,
      amount: 1000,
      currency: 'INR',
      occurredOn: '2026-11-11',
      method: 'upi',
    };
    const settlementId = uuidv7();
    expect(
      (
        await ctx.call(bilal, 'POST', `/api/v1/groups/${group.id}/settlements`, {
          id: settlementId,
          ...payment,
        })
      ).status,
    ).toBe(201);
    await write(bilal, 'PUT', `/api/v1/transactions/${settlementId}`, 1, {
      ...payment,
      method: 'cash',
    });
    await write(asha, 'DELETE', `/api/v1/transactions/${settlementId}`, 2);
    await write(asha, 'POST', `/api/v1/transactions/${settlementId}/restore`, 3);
    // member.claimed: Chitra joins as her placeholder
    await join(asha, group.id, chitra, chitraPlaceholder);
    // member.left: Bilal, settled, leaves
    expect((await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/me`)).status).toBe(
      204,
    );
    // member.deleted: Esha joins, then (settled) deletes her account
    const esha = await person('esha');
    await join(asha, group.id, esha);
    expect((await ctx.call(esha, 'DELETE', '/api/v1/me', { confirm: 'DELETE' })).status).toBe(204);

    const history = (await allOf(asha, group.id)).reverse();
    expect(verbs(history)).toEqual([
      'group.created',
      'member.added',
      'invite.created',
      'member.added',
      'group.renamed',
      'group.updated',
      'member.added',
      'member.removed',
      'invite.created',
      'invite.revoked',
      'transaction.created',
      'transaction.updated',
      'transaction.deleted',
      'transaction.restored',
      'transaction.created',
      'transaction.updated',
      'transaction.deleted',
      'transaction.restored',
      'invite.created', // the link Chitra joins with
      'member.claimed',
      'member.left',
      'invite.created',
      'member.added',
      'member.deleted',
    ]);
    // Every verb but deleting the group, which comes next.
    expect(new Set(verbs(history))).toEqual(
      new Set(ACTIVITY_VERBS.filter((v) => v !== 'group.deleted')),
    );
    expect(history[4]).toMatchObject({ before: { name: 'Goa' }, after: { name: 'Goa 2026' } });
    expect(history[15]).toMatchObject({
      actor: { id: bilal.id },
      before: { paymentMethod: 'upi' },
      after: { paymentMethod: 'cash' },
    });
    // Chitra, who claimed the placeholder, is the target and the actor.
    expect(history[19]).toMatchObject({
      actor: { id: chitra.id },
      target: { id: chitra.id },
      after: { placeholderId: chitraPlaceholder, placeholderName: 'Chitra' },
    });
    expect(history[23]).toMatchObject({
      actor: { id: esha.id, name: 'Deleted user', isDeleted: true },
      after: { left: true },
    });
    expect(history.every((e) => e.groupId === group.id && e.groupName === 'Goa 2026')).toBe(true);

    // group.deleted: everyone is settled, so the owner can delete it.
    expect((await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}`)).status).toBe(204);
    for (const who of [asha, chitra]) {
      const feed = (await allOf(who)).filter((e) => e.groupId === group.id);
      // Only the notice is left of a deleted group.
      expect(verbs(feed)).toEqual(['group.deleted']);
      expect(feed[0]).toMatchObject({ actor: { id: asha.id }, before: { name: 'Goa 2026' } });
    }
    // Bilal left earlier; nothing of the group reaches him any more.
    expect((await allOf(bilal)).filter((e) => e.groupId === group.id)).toEqual([]);
    expect((await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/activity`)).status).toBe(404);
  });
});

describe('my feed', () => {
  it('covers my groups from when I joined, newest first; a group’s feed has its whole history', async () => {
    const [asha, bilal, stranger] = await Promise.all([
      person('asha'),
      person('bilal'),
      person('stranger'),
    ]);
    const group = await newGroup(asha, 'Flat');
    await expense(asha, group.id, expenseBody(asha.id, [asha.id]));
    await join(asha, group.id, bilal);
    const later = await expense(asha, group.id, expenseBody(asha.id, [asha.id, bilal.id]));
    const elsewhere = await newGroup(stranger, 'Elsewhere');
    await expense(stranger, elsewhere.id, expenseBody(stranger.id, [stranger.id]));

    const mine = await allOf(bilal);
    // From his joining on: the invite and the first expense came before.
    expect(verbs(mine)).toEqual(['transaction.created', 'member.added']);
    expect(mine[0]).toMatchObject({ entityId: later.id, actor: { id: asha.id }, involvesMe: true });
    expect(mine[1]).toMatchObject({ actor: { id: bilal.id }, target: { id: bilal.id } });
    expect(mine[0]!.id > mine[1]!.id).toBe(true);

    expect(verbs(await allOf(bilal, group.id))).toEqual([
      'transaction.created',
      'member.added',
      'invite.created',
      'transaction.created',
      'group.created',
    ]);
    expect(verbs(await allOf(asha))).toHaveLength(5);
    // Nothing from a group I'm not in.
    expect((await allOf(bilal)).some((e) => e.groupId === elsewhere.id)).toBe(false);
  });

  it('pages without gaps or repeats, while new entries arrive', async () => {
    const asha = await person('asha');
    const group = await newGroup(asha, 'Paging');
    for (let i = 0; i < 5; i++) await expense(asha, group.id, expenseBody(asha.id, [asha.id]));
    const everything = await allOf(asha);
    expect(everything).toHaveLength(6);

    const first = await feedOf(asha, '?limit=4');
    expect(first.items).toHaveLength(4);
    await expense(asha, group.id, expenseBody(asha.id, [asha.id])); // newer: not on page 2
    const second = await feedOf(asha, `?limit=4&cursor=${first.nextCursor}`);

    expect([...first.items, ...second.items].map((e) => e.id)).toEqual(everything.map((e) => e.id));
    expect(second.nextCursor).toBeNull();
    expect((await feedOf(asha, '?limit=1')).items[0]!.id).toBeGreaterThan(everything[0]!.id);
  });

  it('rejects a malformed cursor or limit', async () => {
    const asha = await person('asha');
    const zero = encodeCursor(0);
    for (const query of [
      '?cursor=nonsense',
      `?cursor=${zero}`,
      '?cursor=!!',
      '?limit=0',
      '?limit=101',
      '?type=expense',
    ]) {
      const res = await ctx.call(asha, 'GET', `/api/v1/activity${query}`);
      expect([res.status, code(res.body)], query).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('is empty for someone in no group', async () => {
    const loner = await person('loner');
    expect(await feedOf(loner)).toEqual({
      items: [],
      nextCursor: null,
      unreadCount: 0,
      people: [],
    });
  });
});

describe('the unread count', () => {
  it('counts others’ entries since I last looked, and never my own', async () => {
    const [asha, bilal] = await Promise.all([person('asha'), person('bilal')]);
    const group = await newGroup(asha, 'Flat');
    const other = await newGroup(asha, 'Other');
    // Asha's own entries don't count.
    expect((await feedOf(asha)).unreadCount).toBe(0);

    await join(asha, group.id, bilal);
    expect((await feedOf(asha)).unreadCount).toBe(1); // Bilal joined
    expect((await feedOf(bilal)).unreadCount).toBe(0); // he did it himself

    await seen(asha);
    expect((await feedOf(asha)).unreadCount).toBe(0);

    await expense(bilal, group.id, expenseBody(bilal.id, [asha.id, bilal.id]));
    await expense(bilal, group.id, expenseBody(bilal.id, [bilal.id]));
    const feed = await feedOf(asha, '?limit=1');
    expect(feed.unreadCount).toBe(2); // the whole feed's count, not the page's
    // A group's count is my feed's, narrowed to it.
    expect((await groupFeedOf(asha, group.id)).unreadCount).toBe(2);
    expect((await groupFeedOf(asha, other.id)).unreadCount).toBe(0);

    await seen(asha);
    expect((await feedOf(asha)).unreadCount).toBe(0);
    expect((await groupFeedOf(asha, group.id)).unreadCount).toBe(0);
  });

  it('marks each entry unread by the same rule, so the feed can show which ones are new', async () => {
    const [asha, bilal] = await Promise.all([person('asha'), person('bilal')]);
    const group = await newGroup(asha, 'Flat');
    await join(asha, group.id, bilal);
    await seen(asha);
    await expense(bilal, group.id, expenseBody(bilal.id, [asha.id, bilal.id]));
    await expense(asha, group.id, expenseBody(asha.id, [asha.id, bilal.id]));

    const unreadVerbs = (feed: {
      items: { verb: string; actor: { id: string }; unread: boolean }[];
    }) =>
      feed.items
        .filter((e) => e.unread)
        .map((e) => `${e.actor.id === bilal.id ? 'bilal' : 'asha'} ${e.verb}`);
    // Only Bilal's expense, made after Asha looked: not his joining (before), nor her own.
    const feed = await feedOf(asha);
    expect(unreadVerbs(feed)).toEqual(['bilal transaction.created']);
    expect(feed.items.filter((e) => e.unread)).toHaveLength(feed.unreadCount);
    expect(unreadVerbs(await groupFeedOf(asha, group.id))).toEqual(['bilal transaction.created']);
    // Nothing is unread for Bilal that he did himself.
    expect((await feedOf(bilal)).items.filter((e) => e.actor.id === bilal.id && e.unread)).toEqual(
      [],
    );

    await seen(asha);
    expect(unreadVerbs(await feedOf(asha))).toEqual([]);
  });
});

describe('people in the feed', () => {
  it('shows a claimed placeholder as whoever claimed them, everywhere', async () => {
    const [asha, chitra] = await Promise.all([person('asha'), person('chitra')]);
    const group = await newGroup(asha, 'Goa', ['Chitra P']);
    const placeholder = group.members[1]!.user.id;
    const tx = await expense(asha, group.id, expenseBody(asha.id, [asha.id, placeholder]));
    const other = await expense(asha, group.id, expenseBody(asha.id, [asha.id]));

    await join(asha, group.id, chitra, placeholder);

    // She takes over the placeholder's membership, so she sees its whole history.
    const feed = await allOf(chitra);
    const created = feed.find((e) => e.entityId === tx.id)!;
    expect(created.involvesMe).toBe(true);
    expect(created.after).toMatchObject({
      payers: [{ userId: asha.id, amount: 1000 }],
      splitInput: {
        method: 'equal',
        participants: expect.arrayContaining([asha.id, chitra.id]) as unknown,
      },
    });
    const shares = (created.after as { shares: { userId: string }[] }).shares.map((s) => s.userId);
    expect(shares.sort()).toEqual([asha.id, chitra.id].sort());
    expect(feed.find((e) => e.entityId === other.id)!.involvesMe).toBe(false);
    // Added as a placeholder: that entry is about her now.
    const added = feed.find((e) => e.verb === 'member.added')!;
    expect(added).toMatchObject({
      target: { id: chitra.id, isPlaceholder: false },
      involvesMe: true,
    });
    // The people the snapshots name, each once, as they are now.
    const page = await feedOf(chitra);
    expect(page.people.map((p) => p.id).sort()).toEqual([asha.id, chitra.id].sort());
    expect(page.people.every((p) => !p.isPlaceholder)).toBe(true);

    // The expense's own history agrees.
    const history = TransactionHistory.parse(
      (await ctx.call(chitra, 'GET', `/api/v1/transactions/${tx.id}/history`)).body,
    );
    expect(history.items[0]).toMatchObject({ involvesMe: true, groupName: 'Goa' });
    expect(JSON.stringify(history.items[0]!.after)).not.toContain(placeholder);
  });

  it('marks what involves me: my money, before or after an edit, or me as the target', async () => {
    const [asha, bilal] = await Promise.all([person('asha'), person('bilal')]);
    const group = await newGroup(asha, 'Flat');
    await join(asha, group.id, bilal);
    const body = expenseBody(asha.id, [asha.id, bilal.id]);
    const tx = await expense(asha, group.id, body);
    // Bilal is taken out of the split: the edit still involves him (he was in it before).
    const { id: _id, ...update } = {
      ...body,
      split: { method: 'equal' as const, participants: [asha.id] },
    };
    await write(asha, 'PUT', `/api/v1/transactions/${tx.id}`, 1, update);
    const unrelated = await expense(asha, group.id, expenseBody(asha.id, [asha.id]));

    const feed = await allOf(bilal);
    const about = (id: string, verb: string) =>
      feed.find((e) => e.entityId === id && e.verb === verb)!;
    expect(about(tx.id, 'transaction.created').involvesMe).toBe(true);
    expect(about(tx.id, 'transaction.updated').involvesMe).toBe(true);
    expect(about(unrelated.id, 'transaction.created').involvesMe).toBe(false);
    expect(about(bilal.id, 'member.added').involvesMe).toBe(true);
  });
});

describe('leaving, removal and friendships', () => {
  it('tells a removed member why the group is gone, and nothing else from it', async () => {
    const [asha, dev] = await Promise.all([person('asha'), person('dev')]);
    const group = await newGroup(asha, 'Flat');
    await join(asha, group.id, dev);
    await expense(asha, group.id, expenseBody(asha.id, [asha.id]));
    expect(
      (await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${dev.id}`)).status,
    ).toBe(204);
    await expense(asha, group.id, expenseBody(asha.id, [asha.id]));

    const feed = (await feedOf(dev)).items.filter((e) => e.groupId === group.id);
    expect(feed).toMatchObject([
      {
        verb: 'member.removed',
        actor: { id: asha.id },
        target: { id: dev.id },
        involvesMe: true,
        groupName: 'Flat',
      },
    ]);
    expect((await feedOf(dev)).unreadCount).toBe(1);
    expect((await ctx.call(dev, 'GET', `/api/v1/groups/${group.id}/activity`)).status).toBe(404);
  });

  it('starts a friendship with “added as a friend” only; its own feed has everything', async () => {
    const asha = await person('asha');
    const added = AddFriendResponse.parse(
      (await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' })).body,
    );

    const feed = (await feedOf(asha)).items.filter((e) => e.groupId === added.groupId);
    expect(feed).toMatchObject([
      { verb: 'member.added', groupName: null, target: { id: added.friend.id } },
    ]);
    expect(verbs((await groupFeedOf(asha, added.groupId)).items)).toEqual([
      'member.added',
      'group.created',
    ]);
  });
});

describe('access', () => {
  it('needs a session; a group’s feed is for its active members', async () => {
    const [asha, stranger] = await Promise.all([person('asha'), person('stranger')]);
    const group = await newGroup(asha, 'Private');

    expect((await ctx.request('/api/v1/activity')).status).toBe(401);
    expect((await ctx.request('/api/v1/activity/seen', { method: 'POST' })).status).toBe(401);
    for (const path of [
      `/api/v1/groups/${group.id}/activity`,
      '/api/v1/groups/not-a-uuid/activity',
    ]) {
      const res = await ctx.call(stranger, 'GET', path);
      expect([res.status, code(res.body)], path).toEqual([404, 'NOT_FOUND']);
    }
  });
});
