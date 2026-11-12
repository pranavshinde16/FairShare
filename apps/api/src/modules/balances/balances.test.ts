// Balances end to end against a fresh database: the group's balances, Home and the friend pages
// (Blueprint 4.6, 10.4 "Friend balance consistency" and "Load sanity check").

import {
  ErrorEnvelope,
  FriendDetail,
  FriendList,
  Group,
  GroupBalances,
  Home,
  InviteCreated,
  Transaction,
  type CreateExpense,
  type Money,
  type SplitInput,
} from '@fairshare/contracts';
import { withTx } from '@fairshare/db';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';
import * as transactionsRepo from '../transactions/repo';

const ctx = await integrationApp({ clock: () => new Date('2026-11-12T10:00:00Z') });
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
type Who = { cookie: string; id: string };

/** GET as `who`, expecting 200, parsed with its contract. */
async function get<T extends z.ZodType>(who: Who, path: string, schema: T): Promise<z.output<T>> {
  const res = await ctx.call(who, 'GET', `/api/v1${path}`);
  expect(res.status, `GET ${path}`).toBe(200);
  return schema.parse(res.body);
}
const balancesOf = (who: Who, groupId: string) =>
  get(who, `/groups/${groupId}/balances`, GroupBalances);
const homeOf = (who: Who) => get(who, '/home', Home);
const friendsOf = (who: Who) => get(who, '/friends', FriendList);
const friendOf = (who: Who, userId: string) => get(who, `/friends/${userId}`, FriendDetail);

async function newGroup(
  owner: Who,
  name: string,
  { currency = 'INR', placeholders = [] as string[] } = {},
) {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name,
    currency,
    members: placeholders.map((p) => ({ name: p })),
  });
  expect(res.status).toBe(201);
  return Group.parse(res.body);
}

/** `who` joins through an invite link from `owner`. */
async function join(owner: Who, groupId: string, ...people: Who[]) {
  const invite = InviteCreated.parse(
    (await ctx.call(owner, 'POST', `/api/v1/groups/${groupId}/invites`, {})).body,
  );
  const token = invite.url.split('/').pop()!;
  for (const who of people) {
    const res = await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {});
    expect(res.status).toBe(200);
  }
}

type Expense = {
  amount: number;
  payers: { userId: string; amount: number }[];
  split: SplitInput;
  currency?: string;
  description?: string;
};

async function expense(who: Who, groupId: string, e: Expense) {
  const body: CreateExpense = {
    id: uuidv7(),
    description: e.description ?? 'Expense',
    amount: e.amount,
    currency: e.currency ?? 'INR',
    occurredOn: '2026-11-10',
    payers: e.payers,
    split: e.split,
  };
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Transaction.parse(res.body);
}

const inr = (amount: number): Money => ({ amount, currency: 'INR' });

/**
 * The worked example (Blueprint 5.3), in paise: Asha, Bilal, Chitra and Dev in Goa.
 * 1. Asha pays the hotel, ₹4,000, split equally among all four.
 * 2. Bilal pays dinner, ₹1,200, split among Asha, Bilal and Chitra.
 * 3. Fuel, ₹3,000: Chitra paid ₹2,000 and Dev ₹1,000, split equally among all four.
 */
async function goa() {
  const [asha, bilal, chitra, dev] = await Promise.all([
    person('asha'),
    person('bilal'),
    person('chitra'),
    person('dev'),
  ]);
  const group = await newGroup(asha, 'Goa Trip');
  await join(asha, group.id, bilal, chitra, dev);
  const all = [asha.id, bilal.id, chitra.id, dev.id];
  const hotel = await expense(asha, group.id, {
    description: 'Hotel',
    amount: 400_000,
    payers: [{ userId: asha.id, amount: 400_000 }],
    split: { method: 'equal', participants: all },
  });
  const dinner = await expense(bilal, group.id, {
    description: 'Dinner',
    amount: 120_000,
    payers: [{ userId: bilal.id, amount: 120_000 }],
    split: { method: 'equal', participants: [asha.id, bilal.id, chitra.id] },
  });
  const fuel = await expense(chitra, group.id, {
    description: 'Fuel',
    amount: 300_000,
    payers: [
      { userId: chitra.id, amount: 200_000 },
      { userId: dev.id, amount: 100_000 },
    ],
    split: { method: 'equal', participants: all },
  });
  return { asha, bilal, chitra, dev, group, hotel, dinner, fuel };
}

/** A settlement written straight to the database: creating them through the API is Phase 9. */
async function settle(groupId: string, from: string, to: string, amount: number) {
  await withTx(ctx.db, (tx) =>
    transactionsRepo.insertTransaction(
      tx,
      {
        id: uuidv7(),
        groupId,
        type: 'settlement',
        description: 'Settlement',
        currency: 'INR',
        amount,
        occurredOn: '2026-11-11',
        paymentMethod: 'upi',
        createdBy: from,
      },
      { payers: [{ userId: from, amount }], shares: [{ userId: to, amount }] },
    ),
  );
}

describe('the Goa example (Blueprint 5.3)', () => {
  it('gives every member the worked nets, the three suggested payments and the explanation', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();

    const balances = await balancesOf(asha, group.id);

    expect(balances.balances).toEqual([
      {
        currency: 'INR',
        // Members in the order they joined.
        nets: [
          { userId: asha.id, amount: 185_000 },
          { userId: bilal.id, amount: -95_000 },
          { userId: chitra.id, amount: -15_000 },
          { userId: dev.id, amount: -75_000 },
        ],
        // Blueprint 5.4: B → A ₹950, D → A ₹750, C → A ₹150.
        transfers: [
          { from: bilal.id, to: asha.id, amount: 95_000 },
          { from: dev.id, to: asha.id, amount: 75_000 },
          { from: chitra.id, to: asha.id, amount: 15_000 },
        ],
      },
    ]);
    expect(balances.me).toEqual({
      net: [inr(185_000)],
      owes: [],
      owed: [
        { from: bilal.id, to: asha.id, amount: 95_000, currency: 'INR' },
        { from: dev.id, to: asha.id, amount: 75_000, currency: 'INR' },
        { from: chitra.id, to: asha.id, amount: 15_000, currency: 'INR' },
      ],
    });
    // paid − share is each net: 4,000 − 2,150; 1,200 − 2,150; 2,000 − 2,150; 1,000 − 1,750.
    expect(balances.breakdown).toEqual([
      { userId: asha.id, paid: inr(400_000), share: inr(215_000), sent: inr(0), received: inr(0) },
      { userId: bilal.id, paid: inr(120_000), share: inr(215_000), sent: inr(0), received: inr(0) },
      {
        userId: chitra.id,
        paid: inr(200_000),
        share: inr(215_000),
        sent: inr(0),
        received: inr(0),
      },
      { userId: dev.id, paid: inr(100_000), share: inr(175_000), sent: inr(0), received: inr(0) },
    ]);

    // Everyone sees the same balances; only "me" differs.
    const fromBilal = await balancesOf(bilal, group.id);
    expect(fromBilal.balances).toEqual(balances.balances);
    expect(fromBilal.breakdown).toEqual(balances.breakdown);
    expect(fromBilal.me).toEqual({
      net: [inr(-95_000)],
      owes: [{ from: bilal.id, to: asha.id, amount: 95_000, currency: 'INR' }],
      owed: [],
    });
  });

  it('shows the same numbers on Home and on the friend pages', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();

    const home = await homeOf(asha);
    expect(home.totals).toEqual([{ currency: 'INR', owed: 185_000, owe: 0 }]);
    expect(home.groups).toHaveLength(1);
    expect(home.groups[0]).toMatchObject({ group: { id: group.id }, myNet: [inr(185_000)] });
    expect(home.people.map((p) => [p.user.id, p.balances, p.directGroupId])).toEqual(
      // Non-zero first, then by name: Bilal, Chitra, Dev.
      [
        [bilal.id, [inr(95_000)], null],
        [chitra.id, [inr(15_000)], null],
        [dev.id, [inr(75_000)], null],
      ],
    );
    expect((await friendsOf(asha)).items).toEqual(home.people);

    // Bilal owes Asha, and nobody else: Chitra and Dev don't show up for him at all.
    const bilalsHome = await homeOf(bilal);
    expect(bilalsHome.totals).toEqual([{ currency: 'INR', owed: 0, owe: 95_000 }]);
    expect(bilalsHome.people.map((p) => [p.user.id, p.balances])).toEqual([
      [asha.id, [inr(-95_000)]],
    ]);

    expect(await friendOf(asha, bilal.id)).toMatchObject({
      user: { id: bilal.id, avatarUrl: null, isPlaceholder: false },
      directGroupId: null,
      total: [inr(95_000)],
      breakdown: [
        { groupId: group.id, groupName: 'Goa Trip', kind: 'group', balance: inr(95_000) },
      ],
    });
    expect((await friendOf(bilal, asha.id)).total).toEqual([inr(-95_000)]);
    // Chitra and Dev share the group but owe each other nothing.
    expect(await friendOf(chitra, dev.id)).toMatchObject({
      total: [],
      breakdown: [{ groupId: group.id, balance: inr(0) }],
    });
  });

  it('drops a deleted expense everywhere, and brings it back exactly on restore', async () => {
    const { asha, bilal, chitra, dev, group, dinner } = await goa();
    const before = await balancesOf(asha, group.id);
    const homeBefore = await homeOf(asha);

    const del = await ctx.request(`/api/v1/transactions/${dinner.id}`, {
      method: 'DELETE',
      cookie: bilal.cookie,
      headers: { 'If-Match': '"1"' },
    });
    expect(del.status).toBe(200);

    // Without dinner: Asha +3,000 − 750, Bilal −1,000 − 750, Chitra −1,000 + 1,250, Dev −750.
    const after = await balancesOf(asha, group.id);
    expect(after.balances[0]!.nets).toEqual([
      { userId: asha.id, amount: 225_000 },
      { userId: bilal.id, amount: -175_000 },
      { userId: chitra.id, amount: 25_000 },
      { userId: dev.id, amount: -75_000 },
    ]);
    expect(after.balances[0]!.transfers).toEqual([
      { from: bilal.id, to: asha.id, amount: 175_000 },
      { from: dev.id, to: asha.id, amount: 50_000 },
      { from: dev.id, to: chitra.id, amount: 25_000 },
    ]);
    expect((await homeOf(asha)).totals).toEqual([{ currency: 'INR', owed: 225_000, owe: 0 }]);
    expect((await homeOf(chitra)).totals).toEqual([{ currency: 'INR', owed: 25_000, owe: 0 }]);
    expect((await friendOf(dev, chitra.id)).total).toEqual([inr(-25_000)]);

    const restore = await ctx.request(`/api/v1/transactions/${dinner.id}/restore`, {
      method: 'POST',
      cookie: asha.cookie,
      headers: { 'If-Match': '"2"' },
    });
    expect(restore.status).toBe(200);
    expect(await balancesOf(asha, group.id)).toEqual(before);
    // The restore is newer activity; nothing else on Home changes.
    const homeAfter = await homeOf(asha);
    const withoutTime = (home: Home) => ({
      ...home,
      groups: home.groups.map((g) => ({ ...g, lastActivityAt: '' })),
    });
    expect(withoutTime(homeAfter)).toEqual(withoutTime(homeBefore));
    expect(homeAfter.groups[0]!.lastActivityAt > homeBefore.groups[0]!.lastActivityAt).toBe(true);
  });

  it('keeps settlement money apart from expenses in the explanation', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();

    // Blueprint 5.5: Bilal pays Asha ₹950, so A +900, B 0, C −150, D −750.
    await settle(group.id, bilal.id, asha.id, 95_000);

    const balances = await balancesOf(asha, group.id);
    expect(balances.balances[0]!.nets).toEqual([
      { userId: asha.id, amount: 90_000 },
      { userId: bilal.id, amount: 0 },
      { userId: chitra.id, amount: -15_000 },
      { userId: dev.id, amount: -75_000 },
    ]);
    expect(balances.balances[0]!.transfers).toEqual([
      { from: dev.id, to: asha.id, amount: 75_000 },
      { from: chitra.id, to: asha.id, amount: 15_000 },
    ]);
    expect(balances.breakdown.slice(0, 2)).toEqual([
      {
        userId: asha.id,
        paid: inr(400_000),
        share: inr(215_000),
        sent: inr(0),
        received: inr(95_000),
      },
      {
        userId: bilal.id,
        paid: inr(120_000),
        share: inr(215_000),
        sent: inr(95_000),
        received: inr(0),
      },
    ]);
    for (const line of balances.breakdown) {
      const net = balances.balances[0]!.nets.find((l) => l.userId === line.userId)!.amount;
      expect(line.paid.amount - line.share.amount + line.sent.amount - line.received.amount).toBe(
        net,
      );
    }

    // Bilal is settled up: nothing on his Home, and Asha's page for him shows the group at zero.
    expect(await homeOf(bilal)).toMatchObject({ totals: [], people: [] });
    expect(await friendOf(asha, bilal.id)).toMatchObject({
      total: [],
      breakdown: [{ groupId: group.id, balance: inr(0) }],
    });
    expect((await homeOf(asha)).totals).toEqual([{ currency: 'INR', owed: 90_000, owe: 0 }]);
  });
});

describe('a group without expenses', () => {
  it('lists every active member as settled, in the group’s currency', async () => {
    const asha = await person('asha');
    const group = await newGroup(asha, 'Flat', { currency: 'USD', placeholders: ['Bilal'] });
    const bilal = group.members[1]!.user.id;

    expect(await balancesOf(asha, group.id)).toEqual({
      balances: [
        {
          currency: 'USD',
          nets: [
            { userId: asha.id, amount: 0 },
            { userId: bilal, amount: 0 },
          ],
          transfers: [],
        },
      ],
      me: { net: [], owes: [], owed: [] },
      breakdown: [asha.id, bilal].map((userId) => ({
        userId,
        paid: { amount: 0, currency: 'USD' },
        share: { amount: 0, currency: 'USD' },
        sent: { amount: 0, currency: 'USD' },
        received: { amount: 0, currency: 'USD' },
      })),
    });
    const home = await homeOf(asha);
    expect(home.totals).toEqual([]);
    expect(home.groups.map((g) => [g.group.id, g.myNet, g.lastActivityAt])).toEqual([
      [group.id, [], group.createdAt],
    ]);
    expect(home.people).toEqual([]);
  });

  it('leaves out someone who left, and they’re no longer a friend there', async () => {
    const [asha, dev] = await Promise.all([person('asha'), person('dev')]);
    const group = await newGroup(asha, 'Flat');
    await join(asha, group.id, dev);
    expect((await friendOf(asha, dev.id)).breakdown).toHaveLength(1);

    expect((await ctx.call(dev, 'DELETE', `/api/v1/groups/${group.id}/members/me`)).status).toBe(
      204,
    );

    const balances = await balancesOf(asha, group.id);
    expect(balances.balances[0]!.nets).toEqual([{ userId: asha.id, amount: 0 }]);
    expect(balances.breakdown.map((l) => l.userId)).toEqual([asha.id]);
    const res = await ctx.call(asha, 'GET', `/api/v1/friends/${dev.id}`);
    expect([res.status, code(res.body)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('Home', () => {
  it('lists groups with a balance first, then the most recently active', async () => {
    const asha = await person('asha');
    const quiet = await newGroup(asha, 'Quiet', { placeholders: ['Bilal'] });
    const owing = await newGroup(asha, 'Owing', { placeholders: ['Chitra'] });
    const busy = await newGroup(asha, 'Busy', { placeholders: ['Dev'] });
    const chitra = owing.members[1]!.user.id;
    const dev = busy.members[1]!.user.id;
    await expense(asha, owing.id, {
      amount: 1000,
      payers: [{ userId: chitra, amount: 1000 }],
      split: { method: 'equal', participants: [asha.id, chitra] },
    });
    // Busy gets newer activity, but it ends up settled: an expense only Dev shares in, paid by Dev.
    await expense(asha, busy.id, {
      amount: 500,
      payers: [{ userId: dev, amount: 500 }],
      split: { method: 'equal', participants: [dev] },
    });

    const home = await homeOf(asha);
    expect(home.groups.map((g) => g.group.id)).toEqual([owing.id, busy.id, quiet.id]);
    expect(home.groups.map((g) => g.myNet)).toEqual([[inr(-500)], [], []]);
    expect(home.totals).toEqual([{ currency: 'INR', owed: 0, owe: 500 }]);
    // A placeholder I owe is a person on Home, like anyone else.
    expect(home.people.map((p) => [p.user.id, p.user.isPlaceholder, p.balances])).toEqual([
      [chitra, true, [inr(-500)]],
    ]);
  });

  it('adds up positives and negatives per group and per currency', async () => {
    const asha = await person('asha');
    const a = await newGroup(asha, 'A', { placeholders: ['Bilal'] });
    const b = await newGroup(asha, 'B', { placeholders: ['Bilal'] });
    const us = await newGroup(asha, 'US', { currency: 'USD', placeholders: ['Bilal'] });
    const pay = (group: Group, payer: string, other: string, amount: number, currency = 'INR') =>
      expense(asha, group.id, {
        amount,
        currency,
        payers: [{ userId: payer, amount }],
        split: { method: 'equal', participants: [payer, other] },
      });
    const other = (g: Group) => g.members[1]!.user.id;
    await pay(a, asha.id, other(a), 1000); // owed 500 in A
    await pay(b, other(b), asha.id, 600); // owe 300 in B
    await pay(us, asha.id, other(us), 2000, 'USD'); // owed $10 in US

    expect((await homeOf(asha)).totals).toEqual([
      { currency: 'INR', owed: 500, owe: 300 },
      { currency: 'USD', owed: 1000, owe: 0 },
    ]);
  });
});

/** A small deterministic PRNG (mulberry32), so a failure can be replayed. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('every screen agrees (Blueprint 10.4 "Friend balance consistency")', () => {
  it('Σ friend balances equals the Home totals, and each friend page explains its number', async () => {
    const random = prng(20261112);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
    const [u0, u1, u2, u3, u4] = await Promise.all([
      person('u0'),
      person('u1'),
      person('u2'),
      person('u3'),
      person('u4'),
    ]);
    const people = [u0, u1, u2, u3, u4];

    const flat = await newGroup(u0, 'Flat', { placeholders: ['Maid'] });
    await join(u0, flat.id, u1, u2, u3);
    const trip = await newGroup(u0, 'Trip');
    await join(u0, trip.id, u1, u4);
    const us = await newGroup(u2, 'US', { currency: 'USD' });
    await join(u2, us.id, u0, u1);
    const friendship = async (a: Who, b: Who) => {
      const res = await ctx.call(a, 'POST', '/api/v1/friends', { userId: b.id });
      expect(res.status).toBe(201);
      return (res.body as { groupId: string }).groupId;
    };
    const d01 = await friendship(u0, u1);
    const d23 = await friendship(u2, u3);

    const maid = flat.members[1]!.user.id;
    const groups = [
      { id: flat.id, currency: 'INR', members: [u0.id, maid, u1.id, u2.id, u3.id] },
      { id: trip.id, currency: 'INR', members: [u0.id, u1.id, u4.id] },
      { id: us.id, currency: 'USD', members: [u2.id, u0.id, u1.id] },
      { id: d01, currency: 'INR', members: [u0.id, u1.id] },
      { id: d23, currency: 'INR', members: [u2.id, u3.id] },
    ];
    const byId = new Map(people.map((p) => [p.id, p]));

    for (let i = 0; i < 40; i++) {
      const group = pick(groups);
      const amount = 1 + Math.floor(random() * 500_000);
      const first = pick(group.members);
      const second = pick(group.members);
      const part = Math.floor(amount * random());
      const payers =
        second === first || part === 0 || part === amount
          ? [{ userId: first, amount }]
          : [
              { userId: first, amount: part },
              { userId: second, amount: amount - part },
            ];
      let participants = group.members.filter(() => random() < 0.7);
      if (participants.length === 0) participants = [pick(group.members)];
      const split: SplitInput =
        random() < 0.5
          ? { method: 'equal', participants }
          : {
              method: 'shares',
              shares: participants.map((userId) => ({
                userId,
                shares: 1 + Math.floor(random() * 3),
              })),
            };
      // Any real member can add it; a placeholder can't sign in.
      const author = byId.get(group.members.find((id) => byId.has(id))!)!;
      await expense(author, group.id, { amount, payers, split, currency: group.currency });
    }

    for (const me of people) {
      const home = await homeOf(me);
      const friends = await friendsOf(me);
      expect(home.people).toEqual(friends.items);

      // My net in each group I'm in, from the group's own balances.
      const myNets = new Map<string, number[]>();
      const groupBalances = new Map<string, GroupBalances>();
      for (const group of groups.filter((g) => g.members.includes(me.id))) {
        const balances = await balancesOf(me, group.id);
        groupBalances.set(group.id, balances);
        for (const net of balances.me.net) {
          myNets.set(net.currency, [...(myNets.get(net.currency) ?? []), net.amount]);
        }
      }
      const expected = [...myNets]
        .map(([currency, nets]) => ({
          currency,
          owed: nets.filter((x) => x > 0).reduce((s, x) => s + x, 0),
          owe: nets.filter((x) => x < 0).reduce((s, x) => s - x, 0),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
      expect(home.totals).toEqual(expected);

      // Σ friend balances == Home's owed − owe, per currency.
      const sums = new Map<string, number>();
      for (const friend of friends.items) {
        for (const b of friend.balances)
          sums.set(b.currency, (sums.get(b.currency) ?? 0) + b.amount);
      }
      for (const total of home.totals) {
        expect(sums.get(total.currency) ?? 0, total.currency).toBe(total.owed - total.owe);
      }

      for (const friend of friends.items) {
        const detail = await friendOf(me, friend.user.id);
        expect(detail.total).toEqual(friend.balances);
        expect(detail.directGroupId).toBe(friend.directGroupId);
        for (const entry of detail.breakdown) {
          // The group's suggested payments between the two of us, seen from my side.
          const balances = groupBalances.get(entry.groupId)!;
          const between =
            balances.me.owed
              .filter((t) => t.from === friend.user.id && t.currency === entry.balance.currency)
              .reduce((s, t) => s + t.amount, 0) -
            balances.me.owes
              .filter((t) => t.to === friend.user.id && t.currency === entry.balance.currency)
              .reduce((s, t) => s + t.amount, 0);
          expect(entry.balance.amount).toBe(between);
        }
        const other = byId.get(friend.user.id);
        if (other) {
          const mirror = await friendOf(other, me.id);
          expect(mirror.total).toEqual(friend.balances.map((b) => ({ ...b, amount: -b.amount })));
        }
      }
    }
  });
});

describe('access', () => {
  it('answers only members, and hides people I share no group with', async () => {
    const [asha, stranger] = await Promise.all([person('asha'), person('stranger')]);
    const group = await newGroup(asha, 'Goa', { placeholders: ['Bilal'] });
    const bilal = group.members[1]!.user.id;

    const status = async (who: Who | null, path: string) => {
      const res = await ctx.call(who, 'GET', `/api/v1${path}`);
      return res.status === 200 ? 200 : [res.status, code(res.body)];
    };
    expect(await status(null, `/groups/${group.id}/balances`)).toEqual([401, 'UNAUTHENTICATED']);
    expect(await status(null, '/home')).toEqual([401, 'UNAUTHENTICATED']);
    expect(await status(null, `/friends/${bilal}`)).toEqual([401, 'UNAUTHENTICATED']);
    expect(await status(stranger, `/groups/${group.id}/balances`)).toEqual([404, 'NOT_FOUND']);
    expect(await status(stranger, '/groups/not-a-uuid/balances')).toEqual([404, 'NOT_FOUND']);
    expect(await status(stranger, `/friends/${bilal}`)).toEqual([404, 'NOT_FOUND']);
    expect(await status(stranger, `/friends/${asha.id}`)).toEqual([404, 'NOT_FOUND']);
    expect(await status(asha, `/friends/${asha.id}`)).toEqual([404, 'NOT_FOUND']);
    expect(await status(asha, '/friends/not-a-uuid')).toEqual([404, 'NOT_FOUND']);
    expect(await status(asha, `/friends/${bilal}`)).toBe(200);
    expect(await status(asha, `/friends/${bilal.toUpperCase()}`)).toBe(200);
    expect(await status(stranger, '/home')).toBe(200);
  });
});

describe('load sanity check (Blueprint 10.4)', () => {
  it('answers GET /balances for 5,000 expenses among 12 members within 50 ms at p95', async () => {
    const owner = await person('owner');
    const group = await newGroup(owner, 'Big', {
      placeholders: Array.from({ length: 11 }, (_, i) => `P${i + 1}`),
    });
    const members = group.members.map((m) => m.user.id);
    expect(members).toHaveLength(12);
    const ids = sql`ARRAY[${sql.join(
      members.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`;

    // Each expense: one payer in turn, split equally among all 12 (amounts divisible by 12).
    await withTx(ctx.db, async (tx) => {
      await tx.execute(sql`
        CREATE TEMP TABLE load_tx ON COMMIT DROP AS
        SELECT i, gen_random_uuid() AS id, 1200 * (1 + i % 50) AS amount
        FROM generate_series(1, 5000) AS i`);
      await tx.execute(sql`
        INSERT INTO transactions (id, group_id, type, description, currency, amount, occurred_on, split_method, created_by)
        SELECT id, ${group.id}, 'expense', 'Load ' || i, 'INR', amount, DATE '2026-01-01' + (i % 300), 'equal', ${owner.id}
        FROM load_tx`);
      await tx.execute(sql`
        INSERT INTO transaction_payers (transaction_id, user_id, amount)
        SELECT id, (${ids})[1 + i % 12], amount FROM load_tx`);
      await tx.execute(sql`
        INSERT INTO transaction_shares (transaction_id, user_id, amount)
        SELECT id, m, amount / 12 FROM load_tx, unnest(${ids}) AS m`);
    });
    await ctx.db.execute(sql`ANALYZE transactions, transaction_payers, transaction_shares`);

    const path = `/groups/${group.id}/balances`;
    const first = await balancesOf(owner, group.id);
    expect(first.balances[0]!.nets.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(first.balances[0]!.transfers.length).toBeLessThanOrEqual(11);
    for (let i = 0; i < 5; i++) await balancesOf(owner, group.id); // warm up

    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const res = await ctx.request(`/api/v1${path}`, { cookie: owner.cookie });
      await res.arrayBuffer();
      times.push(performance.now() - start);
      expect(res.status).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    console.info(
      `GET /balances, 5,000 expenses × 12 members: p50 ${times[24]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
    );
    // The target is for a developer machine (about 29 ms here). Shared CI runners are slower and
    // noisier, so there the bound only catches a regression of a different order (a lost index,
    // a query per expense).
    expect(p95).toBeLessThan(process.env.CI ? 150 : 50);
  }, 120_000);
});
