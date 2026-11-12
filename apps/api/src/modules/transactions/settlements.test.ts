// Settlements end to end against a fresh database (Blueprint 4.8, 5.5, 5.6, 10.4 "Settlements"):
// recording a payment, partial and over-payments, settling every suggested payment, editing an
// expense after a payment, editing, deleting and restoring a payment, validation and access.

import {
  AddFriendResponse,
  DeletedTransaction,
  ErrorEnvelope,
  FriendDetail,
  Group,
  GroupBalances,
  Home,
  InviteCreated,
  Transaction,
  TransactionHistory,
  TransactionPage,
  type CreateExpense,
  type CreateSettlement,
  type Money,
  type SplitInput,
  type UpdateSettlement,
} from '@fairshare/contracts';
import { activityLog, transactions } from '@fairshare/db';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp({ clock: () => new Date('2026-11-12T10:00:00Z') });
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
const inr = (amount: number): Money => ({ amount, currency: 'INR' });
type Who = { cookie: string; id: string };

async function get<T extends z.ZodType>(who: Who, path: string, schema: T): Promise<z.output<T>> {
  const res = await ctx.call(who, 'GET', `/api/v1${path}`);
  expect(res.status, `GET ${path}`).toBe(200);
  return schema.parse(res.body);
}
const balancesOf = (who: Who, groupId: string) =>
  get(who, `/groups/${groupId}/balances`, GroupBalances);

/** The group's nets as {userId: amount}, from GET /balances (zeros included). */
async function netsOf(who: Who, groupId: string) {
  const { balances } = await balancesOf(who, groupId);
  return Object.fromEntries(balances[0]!.nets.map((l) => [l.userId, l.amount]));
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

async function expense(
  who: Who,
  groupId: string,
  e: { amount: number; payers: { userId: string; amount: number }[]; split: SplitInput },
  currency = 'INR',
) {
  const body: CreateExpense = {
    id: uuidv7(),
    description: 'Expense',
    amount: e.amount,
    currency,
    occurredOn: '2026-11-10',
    payers: e.payers,
    split: e.split,
  };
  const res = await ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Transaction.parse(res.body);
}

const payment = (
  from: string,
  to: string,
  amount: number,
  extra: Partial<CreateSettlement> = {},
): CreateSettlement => ({
  id: uuidv7(),
  fromUserId: from,
  toUserId: to,
  amount,
  currency: 'INR',
  occurredOn: '2026-11-11',
  method: 'upi',
  ...extra,
});

const record = (who: Who, groupId: string, body: unknown) =>
  ctx.call(who, 'POST', `/api/v1/groups/${groupId}/settlements`, body);

/** Records a payment, expecting 201. */
async function settle(who: Who, groupId: string, body: CreateSettlement) {
  const res = await record(who, groupId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Transaction.parse(res.body);
}

/** A PUT/DELETE/restore with If-Match (none when version is null). */
async function write(
  who: Who,
  method: 'PUT' | 'DELETE' | 'POST',
  path: string,
  version: number | null,
  body?: unknown,
) {
  const res = await ctx.request(path, {
    method,
    cookie: who.cookie,
    body,
    headers: version === null ? {} : { 'If-Match': `"${version}"` },
  });
  return { status: res.status, body: await res.json() };
}

const edit = (who: Who, id: string, version: number | null, body: unknown) =>
  write(who, 'PUT', `/api/v1/transactions/${id}`, version, body);

/** A stored settlement's request body, for edits. */
const asUpdate = (body: CreateSettlement): UpdateSettlement => {
  const { id: _id, ...rest } = body;
  return rest;
};

const activityOf = (id: string) =>
  ctx.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, id))
    .orderBy(asc(activityLog.id));

async function transactionCount(groupId: string) {
  const [row] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.groupId, groupId));
  return row!.count;
}

/**
 * The worked example (Blueprint 5.3), in paise. Nets: A +1,850, B −950, C −150, D −750.
 * Hotel ₹4,000 paid by Asha for all four; dinner ₹1,200 paid by Bilal for Asha, Bilal, Chitra;
 * fuel ₹3,000 paid by Chitra (₹2,000) and Dev (₹1,000) for all four.
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
  await expense(asha, group.id, {
    amount: 400_000,
    payers: [{ userId: asha.id, amount: 400_000 }],
    split: { method: 'equal', participants: all },
  });
  const dinner = await expense(bilal, group.id, {
    amount: 120_000,
    payers: [{ userId: bilal.id, amount: 120_000 }],
    split: { method: 'equal', participants: [asha.id, bilal.id, chitra.id] },
  });
  await expense(chitra, group.id, {
    amount: 300_000,
    payers: [
      { userId: chitra.id, amount: 200_000 },
      { userId: dev.id, amount: 100_000 },
    ],
    split: { method: 'equal', participants: all },
  });
  return { asha, bilal, chitra, dev, group, dinner };
}

describe('recording a payment', () => {
  it('stores one payer and one recipient for the same amount (Blueprint 5.5)', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000, {
      reference: 'UTR 431298765012',
      note: 'For the trip',
    });

    const res = await record(bilal, group.id, body);

    expect(res.status).toBe(201);
    const tx = Transaction.parse(res.body);
    expect(tx).toMatchObject({
      id: body.id,
      groupId: group.id,
      type: 'settlement',
      description: 'Settlement',
      notes: 'For the trip',
      amount: 95_000,
      currency: 'INR',
      occurredOn: '2026-11-11',
      splitMethod: null,
      splitInput: null,
      payers: [{ userId: bilal.id, amount: 95_000 }],
      shares: [{ userId: asha.id, amount: 95_000 }],
      paymentMethod: 'upi',
      paymentRef: 'UTR 431298765012',
      createdBy: { id: bilal.id },
      updatedBy: null,
      deletedAt: null,
      version: 1,
      myNet: 95_000,
    });
    // The other side of the same payment.
    expect((await get(asha, `/transactions/${body.id}`, Transaction)).myNet).toBe(-95_000);
    expect((await get(chitra, `/transactions/${body.id}`, Transaction)).myNet).toBe(0);

    // A +900, B 0, C −150, D −750.
    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: 90_000,
      [bilal.id]: 0,
      [chitra.id]: -15_000,
      [dev.id]: -75_000,
    });

    const [entry] = await activityOf(body.id);
    expect(entry).toMatchObject({
      verb: 'transaction.created',
      actorId: bilal.id,
      groupId: group.id,
      before: null,
      after: {
        description: 'Settlement',
        amount: 95_000,
        currency: 'INR',
        occurredOn: '2026-11-11',
        notes: 'For the trip',
        splitMethod: null,
        splitInput: null,
        payers: [{ userId: bilal.id, amount: 95_000 }],
        shares: [{ userId: asha.id, amount: 95_000 }],
        paymentMethod: 'upi',
        paymentRef: 'UTR 431298765012',
      },
    });
  });

  it('is recorded by anyone in the group, for any two members, placeholders included', async () => {
    const asha = await person('asha');
    const group = await newGroup(asha, 'Flat', ['Bilal', 'Chitra']);
    const [bilal, chitra] = group.members.slice(1).map((m) => m.user.id) as [string, string];
    await expense(asha, group.id, {
      amount: 90_000,
      payers: [{ userId: bilal, amount: 90_000 }],
      split: { method: 'equal', participants: [asha.id, bilal, chitra] },
    });

    // Asha notes that Chitra paid Bilal back; she is neither of them.
    const tx = await settle(asha, group.id, payment(chitra, bilal, 30_000, { method: 'cash' }));

    expect(tx).toMatchObject({ paymentMethod: 'cash', myNet: 0, createdBy: { id: asha.id } });
    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: -30_000,
      [bilal]: 30_000,
      [chitra]: 0,
    });
  });

  it('takes a partial payment: the balance moves partway', async () => {
    const { asha, dev, group } = await goa();

    await settle(dev, group.id, payment(dev.id, asha.id, 50_000));

    const balances = await balancesOf(dev, group.id);
    expect(balances.me.net).toEqual([inr(-25_000)]);
    expect(balances.me.owes).toEqual([
      { from: dev.id, to: asha.id, amount: 25_000, currency: 'INR' },
    ]);
  });

  it('takes an overpayment: the direction flips instead of failing', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();

    // Chitra owes ₹150 and pays ₹200.
    await settle(chitra, group.id, payment(chitra.id, asha.id, 20_000));

    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: 165_000,
      [bilal.id]: -95_000,
      [chitra.id]: 5_000,
      [dev.id]: -75_000,
    });
    const balances = await balancesOf(chitra, group.id);
    expect(balances.me.net).toEqual([inr(5_000)]);
    expect(balances.me.owed.reduce((sum, t) => sum + t.amount, 0)).toBe(5_000);
  });

  it('keeps settlement money apart in the explanation', async () => {
    const { asha, bilal, group } = await goa();
    await settle(asha, group.id, payment(bilal.id, asha.id, 95_000));

    const { breakdown } = await balancesOf(asha, group.id);
    const of = (userId: string) => breakdown.find((b) => b.userId === userId)!;
    expect(of(asha.id)).toMatchObject({ sent: inr(0), received: inr(95_000) });
    expect(of(bilal.id)).toMatchObject({ sent: inr(95_000), received: inr(0) });
  });

  it('lists payments in the group’s history, and filters by type', async () => {
    const { asha, bilal, group } = await goa();
    const tx = await settle(bilal, group.id, payment(bilal.id, asha.id, 95_000));

    const all = await get(asha, `/groups/${group.id}/transactions`, TransactionPage);
    expect(all.items.map((t) => t.type)).toEqual(['settlement', 'expense', 'expense', 'expense']);
    const only = await get(
      asha,
      `/groups/${group.id}/transactions?type=settlement`,
      TransactionPage,
    );
    expect(only.items.map((t) => t.id)).toEqual([tx.id]);
    const people = await get(
      asha,
      `/groups/${group.id}/transactions?type=settlement&person=${bilal.id}`,
      TransactionPage,
    );
    expect(people.items.map((t) => t.id)).toEqual([tx.id]);
  });
});

describe('settling up', () => {
  it('recording every suggested payment brings everyone to zero, everywhere', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();
    const people = { [asha.id]: asha, [bilal.id]: bilal, [chitra.id]: chitra, [dev.id]: dev };

    const before = await balancesOf(asha, group.id);
    expect(before.balances[0]!.transfers).toHaveLength(3);
    for (const t of before.balances[0]!.transfers) {
      await settle(people[t.from]!, group.id, payment(t.from, t.to, t.amount));
    }

    const after = await balancesOf(asha, group.id);
    expect(after.balances[0]!.nets.every((l) => l.amount === 0)).toBe(true);
    expect(after.balances[0]!.transfers).toEqual([]);
    for (const who of [asha, bilal, chitra, dev]) {
      const home = await get(who, '/home', Home);
      expect(home.totals).toEqual([]);
      expect(home.groups.find((g) => g.group.id === group.id)!.myNet).toEqual([]);
      expect((await balancesOf(who, group.id)).me).toEqual({ net: [], owes: [], owed: [] });
    }
    const friend = await get(asha, `/friends/${bilal.id}`, FriendDetail);
    expect(friend.total).toEqual([]);
  });

  it('settles any random group with its suggested payments', async () => {
    // A fixed seed: the same "random" group every run.
    const random = mulberry32(20261112);
    const owner = await person('owner');
    const group = await newGroup(owner, 'Random', ['P1', 'P2', 'P3', 'P4', 'P5']);
    const ids = group.members.map((m) => m.user.id);
    const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;

    for (let i = 0; i < 30; i++) {
      const amount = 1 + Math.floor(random() * 500_000);
      const participants = ids.filter(() => random() < 0.6);
      if (participants.length === 0) participants.push(pick(ids));
      const payerA = pick(ids);
      const payerB = pick(ids.filter((id) => id !== payerA));
      const first = Math.floor(amount / 3);
      const payers =
        random() < 0.3 && first > 0
          ? [
              { userId: payerA, amount: first },
              { userId: payerB, amount: amount - first },
            ]
          : [{ userId: payerA, amount }];
      const split: SplitInput =
        random() < 0.5
          ? { method: 'equal', participants }
          : {
              method: 'shares',
              shares: participants.map((userId) => ({
                userId,
                shares: 1 + Math.floor(random() * 4),
              })),
            };
      await expense(owner, group.id, { amount, payers, split });
      // A few partial payments along the way.
      if (i % 7 === 6) {
        const { balances } = await balancesOf(owner, group.id);
        const t = balances[0]!.transfers[0];
        if (t) await settle(owner, group.id, payment(t.from, t.to, Math.ceil(t.amount / 2)));
      }
    }

    const { balances } = await balancesOf(owner, group.id);
    expect(balances[0]!.transfers.length).toBeGreaterThan(0);
    expect(balances[0]!.transfers.length).toBeLessThanOrEqual(ids.length - 1);
    for (const t of balances[0]!.transfers) {
      await settle(owner, group.id, payment(t.from, t.to, t.amount));
    }
    const after = await balancesOf(owner, group.id);
    expect(after.balances[0]!.nets.map((l) => l.amount)).toEqual(ids.map(() => 0));
    expect(after.balances[0]!.transfers).toEqual([]);
  });

  it('settles a friendship from the friend page’s numbers', async () => {
    const asha = await person('asha');
    const added = AddFriendResponse.parse(
      (await ctx.call(asha, 'POST', '/api/v1/friends', { name: 'Bilal' })).body,
    );
    const bilal = added.friend.id;
    const direct = await get(asha, `/groups/${added.groupId}`, Group);
    await expense(
      asha,
      direct.id,
      {
        amount: 60_000,
        payers: [{ userId: asha.id, amount: 60_000 }],
        split: { method: 'equal', participants: [asha.id, bilal] },
      },
      direct.currency,
    );
    const before = await get(asha, `/friends/${bilal}`, FriendDetail);
    expect(before.total).toEqual([{ amount: 30_000, currency: direct.currency }]);

    await settle(asha, direct.id, {
      ...payment(bilal, asha.id, before.total[0]!.amount),
      currency: direct.currency,
    });

    const after = await get(asha, `/friends/${bilal}`, FriendDetail);
    expect(after.total).toEqual([]);
    expect(after.breakdown).toEqual([
      {
        groupId: direct.id,
        groupName: null,
        kind: 'direct',
        balance: { amount: 0, currency: direct.currency },
      },
    ]);
  });
});

describe('editing an expense after a payment (Blueprint 5.6)', () => {
  it('recomputes everything: A +800, B +200, C −250, D −750, and Bilal is now owed', async () => {
    const { asha, bilal, chitra, dev, group, dinner } = await goa();
    await settle(bilal, group.id, payment(bilal.id, asha.id, 95_000));

    // Dinner corrected from ₹1,200 to ₹1,500.
    const res = await edit(bilal, dinner.id, dinner.version, {
      description: 'Expense',
      amount: 150_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      payers: [{ userId: bilal.id, amount: 150_000 }],
      split: { method: 'equal', participants: [asha.id, bilal.id, chitra.id] },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: 80_000,
      [bilal.id]: 20_000,
      [chitra.id]: -25_000,
      [dev.id]: -75_000,
    });
    expect((await balancesOf(bilal, group.id)).me.net).toEqual([inr(20_000)]);
    const home = await get(bilal, '/home', Home);
    expect(home.totals).toEqual([{ currency: 'INR', owed: 20_000, owe: 0 }]);
  });
});

describe('editing a payment', () => {
  it('replaces it with a new version, recorded in its history', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);

    // It was ₹500 by cash, not ₹950 by UPI.
    const res = await edit(asha, tx.id, 1, {
      ...asUpdate(body),
      amount: 50_000,
      method: 'cash',
      note: 'Rest next week',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Transaction.parse(res.body)).toMatchObject({
      type: 'settlement',
      amount: 50_000,
      payers: [{ userId: bilal.id, amount: 50_000 }],
      shares: [{ userId: asha.id, amount: 50_000 }],
      paymentMethod: 'cash',
      paymentRef: null,
      notes: 'Rest next week',
      version: 2,
      updatedBy: { id: asha.id },
      myNet: -50_000,
    });
    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: 135_000,
      [bilal.id]: -45_000,
      [chitra.id]: -15_000,
      [dev.id]: -75_000,
    });

    const history = await get(asha, `/transactions/${tx.id}/history`, TransactionHistory);
    expect(history.items.map((e) => e.verb)).toEqual([
      'transaction.created',
      'transaction.updated',
    ]);
    expect(history.items[1]).toMatchObject({
      actor: { id: asha.id },
      involvesMe: true,
      before: { amount: 95_000, paymentMethod: 'upi', notes: null },
      after: { amount: 50_000, paymentMethod: 'cash', notes: 'Rest next week' },
    });
  });

  it('counts a change of method or reference alone as an edit', async () => {
    const { asha, bilal, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);

    const method = await edit(bilal, tx.id, 1, { ...asUpdate(body), method: 'bank_transfer' });
    expect(Transaction.parse(method.body)).toMatchObject({
      version: 2,
      paymentMethod: 'bank_transfer',
    });
    const reference = await edit(bilal, tx.id, 2, {
      ...asUpdate(body),
      method: 'bank_transfer',
      reference: 'NEFT 77',
    });
    expect(Transaction.parse(reference.body)).toMatchObject({ version: 3, paymentRef: 'NEFT 77' });

    const entries = await activityOf(tx.id);
    expect(entries.map((e) => e.verb)).toEqual([
      'transaction.created',
      'transaction.updated',
      'transaction.updated',
    ]);
    expect(entries[2]!.after).toMatchObject({
      paymentMethod: 'bank_transfer',
      paymentRef: 'NEFT 77',
    });
  });

  it('can turn the payment around', async () => {
    const { asha, bilal, chitra, dev, group } = await goa();
    const body = payment(bilal.id, asha.id, 10_000);
    const tx = await settle(bilal, group.id, body);

    const res = await edit(bilal, tx.id, 1, {
      ...asUpdate(body),
      fromUserId: asha.id,
      toUserId: bilal.id,
    });

    expect(Transaction.parse(res.body)).toMatchObject({
      payers: [{ userId: asha.id, amount: 10_000 }],
      shares: [{ userId: bilal.id, amount: 10_000 }],
      myNet: -10_000,
    });
    expect(await netsOf(asha, group.id)).toEqual({
      [asha.id]: 195_000,
      [bilal.id]: -105_000,
      [chitra.id]: -15_000,
      [dev.id]: -75_000,
    });
  });

  it('treats an unchanged body as a no-op', async () => {
    const { asha, bilal, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000, { note: '  Thanks  ' });
    const tx = await settle(bilal, group.id, body);

    // The note is trimmed on the way in, so the same text with other spacing is the same payment.
    const res = await edit(asha, tx.id, 1, { ...asUpdate(body), note: 'Thanks' });

    expect(Transaction.parse(res.body)).toMatchObject({ version: 1, updatedBy: null });
    expect(await activityOf(tx.id)).toHaveLength(1);
  });

  it('refuses a stale version, a missing If-Match, and a deleted payment', async () => {
    const { asha, bilal, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);
    await edit(bilal, tx.id, 1, { ...asUpdate(body), amount: 90_000 });

    const stale = await edit(asha, tx.id, 1, { ...asUpdate(body), amount: 80_000 });
    expect(stale.status).toBe(409);
    expect(ErrorEnvelope.parse(stale.body).error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
    const missing = await edit(asha, tx.id, null, asUpdate(body));
    expect([missing.status, code(missing.body)]).toEqual([428, 'IF_MATCH_REQUIRED']);

    const deleted = DeletedTransaction.parse(
      (await write(asha, 'DELETE', `/api/v1/transactions/${tx.id}`, 2)).body,
    );
    const afterDelete = await edit(asha, tx.id, deleted.version, asUpdate(body));
    expect([afterDelete.status, code(afterDelete.body)]).toEqual([409, 'TRANSACTION_DELETED']);
  });

  it('wants the body that matches the stored type', async () => {
    const { asha, bilal, chitra, group, dinner } = await goa();
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);
    const expenseBody = {
      description: 'Dinner',
      amount: 120_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      payers: [{ userId: bilal.id, amount: 120_000 }],
      split: { method: 'equal', participants: [asha.id, bilal.id, chitra.id] },
    };

    const expenseOnPayment = await edit(asha, tx.id, 1, expenseBody);
    expect([expenseOnPayment.status, code(expenseOnPayment.body)]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    // A settlement's edit is the whole settlement: nothing missing, nothing extra.
    const { method: _method, ...partial } = asUpdate(body);
    for (const sent of [partial, { amount: 500 }, { ...asUpdate(body), splitMethod: 'equal' }]) {
      const res = await edit(asha, tx.id, 1, sent);
      expect([res.status, code(res.body)], JSON.stringify(sent)).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
    const paymentOnExpense = await edit(asha, dinner.id, dinner.version, asUpdate(body));
    expect([paymentOnExpense.status, code(paymentOnExpense.body)]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
    // Neither changed.
    expect((await get(asha, `/transactions/${tx.id}`, Transaction)).version).toBe(1);
    expect((await get(asha, `/transactions/${dinner.id}`, Transaction)).version).toBe(1);
  });

  it('applies the same rules as recording one', async () => {
    const { asha, bilal, group } = await goa();
    const stranger = await person('stranger');
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);

    const cases: [Partial<UpdateSettlement>, number, string][] = [
      [{ toUserId: bilal.id }, 422, 'SETTLEMENT_SAME_USER'],
      [{ toUserId: stranger.id }, 422, 'NOT_A_MEMBER'],
      [{ currency: 'USD' }, 422, 'CURRENCY_MISMATCH'],
      [{ amount: 0 }, 400, 'VALIDATION_FAILED'],
      [{ occurredOn: '2027-11-13' }, 400, 'VALIDATION_FAILED'],
    ];
    for (const [change, status, expected] of cases) {
      const res = await edit(asha, tx.id, 1, { ...asUpdate(body), ...change });
      expect([res.status, code(res.body)], JSON.stringify(change)).toEqual([status, expected]);
    }
    expect((await get(asha, `/transactions/${tx.id}`, Transaction)).version).toBe(1);
  });
});

describe('deleting and restoring a payment', () => {
  it('drops it from the balances, and restoring brings it back exactly', async () => {
    const { asha, bilal, group } = await goa();
    const goaNets = await netsOf(asha, group.id);
    const tx = await settle(bilal, group.id, payment(bilal.id, asha.id, 95_000));
    const settledNets = await netsOf(asha, group.id);

    const deleted = await write(asha, 'DELETE', `/api/v1/transactions/${tx.id}`, 1);
    expect(deleted.status).toBe(200);
    expect(await netsOf(asha, group.id)).toEqual(goaNets);

    const restored = await write(bilal, 'POST', `/api/v1/transactions/${tx.id}/restore`, 2);
    expect(restored.status).toBe(200);
    expect(Transaction.parse(restored.body)).toMatchObject({ version: 3, deletedAt: null });
    expect(await netsOf(asha, group.id)).toEqual(settledNets);

    const entries = await activityOf(tx.id);
    expect(entries.map((e) => [e.verb, e.actorId])).toEqual([
      ['transaction.created', bilal.id],
      ['transaction.deleted', asha.id],
      ['transaction.restored', bilal.id],
    ]);
    expect(entries[1]!.before).toMatchObject({ paymentMethod: 'upi', amount: 95_000 });
    expect(entries[2]!.after).toMatchObject({ paymentMethod: 'upi', amount: 95_000 });
  });

  it('can’t restore a payment once one of the two has left the group', async () => {
    const [asha, bilal] = await Promise.all([person('asha'), person('bilal')]);
    const group = await newGroup(asha, 'Two');
    await join(asha, group.id, bilal);
    // Two payments that cancel out, both deleted: Bilal is settled and may leave.
    const there = await settle(bilal, group.id, payment(bilal.id, asha.id, 30_000));
    const back = await settle(asha, group.id, payment(asha.id, bilal.id, 30_000));
    await write(asha, 'DELETE', `/api/v1/transactions/${there.id}`, 1);
    await write(asha, 'DELETE', `/api/v1/transactions/${back.id}`, 1);
    const left = await ctx.call(bilal, 'DELETE', `/api/v1/groups/${group.id}/members/${bilal.id}`);
    expect(left.status).toBe(204);

    const res = await write(asha, 'POST', `/api/v1/transactions/${there.id}/restore`, 2);

    expect([res.status, code(res.body)]).toEqual([422, 'MEMBER_INACTIVE']);
    expect(ErrorEnvelope.parse(res.body).error.message).toContain('payment');
  });
});

describe('idempotency (C6)', () => {
  it('replays the same payment (200) and refuses its ID for anything else (409)', async () => {
    const { asha, bilal, chitra, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000, { reference: 'R1' });
    const first = await settle(bilal, group.id, body);

    const again = await record(bilal, group.id, body);
    expect(again.status).toBe(200);
    expect(Transaction.parse(again.body)).toEqual(first);
    // Upper-case IDs are the same IDs.
    const upper = await record(bilal, group.id, {
      ...body,
      id: body.id.toUpperCase(),
      fromUserId: bilal.id.toUpperCase(),
    });
    expect(upper.status).toBe(200);
    expect(await activityOf(body.id)).toHaveLength(1);

    const conflicts: [Who, unknown, string][] = [
      [bilal, { ...body, amount: 1 }, 'settlements'],
      [bilal, { ...body, method: 'cash' }, 'settlements'],
      [bilal, { ...body, reference: 'R2' }, 'settlements'],
      [chitra, body, 'settlements'],
      // The same ID as an expense.
      [
        bilal,
        {
          id: body.id,
          description: 'Dinner',
          amount: 95_000,
          currency: 'INR',
          occurredOn: '2026-11-11',
          payers: [{ userId: bilal.id, amount: 95_000 }],
          split: { method: 'equal', participants: [asha.id] },
        },
        'expenses',
      ],
    ];
    for (const [who, conflicting, path] of conflicts) {
      const res = await ctx.call(who, 'POST', `/api/v1/groups/${group.id}/${path}`, conflicting);
      expect([res.status, code(res.body)], JSON.stringify(conflicting)).toEqual([
        409,
        'ID_CONFLICT',
      ]);
    }

    // An expense's ID can't be reused for a payment either.
    const { dinner } = await goa();
    const reused = await record(bilal, group.id, { ...body, id: dinner.id });
    expect([reused.status, code(reused.body)]).toEqual([409, 'ID_CONFLICT']);
  });

  it('two identical requests at once create one payment', async () => {
    const { asha, bilal, group } = await goa();
    const body = payment(bilal.id, asha.id, 95_000);

    const results = await Promise.all([
      record(bilal, group.id, body),
      record(bilal, group.id, body),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await activityOf(body.id)).toHaveLength(1);
    expect((await netsOf(asha, group.id))[bilal.id]).toBe(0);
  });
});

describe('validation', () => {
  it('refuses what can’t be a payment, and writes nothing', async () => {
    const { asha, bilal, chitra, group } = await goa();
    const [stranger, leaver] = await Promise.all([person('stranger'), person('leaver')]);
    await join(asha, group.id, leaver);
    expect(
      (await ctx.call(leaver, 'DELETE', `/api/v1/groups/${group.id}/members/${leaver.id}`)).status,
    ).toBe(204);
    const before = await transactionCount(group.id);
    const valid = payment(bilal.id, asha.id, 95_000);

    const cases: [unknown, number, string][] = [
      [{ ...valid, toUserId: bilal.id }, 422, 'SETTLEMENT_SAME_USER'],
      [{ ...valid, toUserId: bilal.id.toUpperCase() }, 422, 'SETTLEMENT_SAME_USER'],
      [{ ...valid, fromUserId: stranger.id }, 422, 'NOT_A_MEMBER'],
      [{ ...valid, toUserId: stranger.id }, 422, 'NOT_A_MEMBER'],
      [{ ...valid, toUserId: leaver.id }, 422, 'MEMBER_INACTIVE'],
      [{ ...valid, currency: 'USD' }, 422, 'CURRENCY_MISMATCH'],
      [{ ...valid, amount: 0 }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, amount: -100 }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, amount: 1.5 }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, amount: 10_000_000_001 }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, method: 'cheque' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, reference: 'x'.repeat(101) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, note: 'x'.repeat(1001) }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, occurredOn: '2027-11-13' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, occurredOn: '2026-02-30' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, description: 'Payback' }, 400, 'VALIDATION_FAILED'],
      [{ ...valid, id: 'not-a-uuid' }, 400, 'VALIDATION_FAILED'],
      [(({ method: _m, ...rest }) => rest)(valid), 400, 'VALIDATION_FAILED'],
    ];
    for (const [body, status, expected] of cases) {
      const res = await record(chitra, group.id, body);
      expect([res.status, code(res.body)], JSON.stringify(body)).toEqual([status, expected]);
    }
    expect(await transactionCount(group.id)).toBe(before);
  });

  it('accepts a date up to a year ahead, as expenses do', async () => {
    const { asha, bilal, group } = await goa();
    const res = await record(
      bilal,
      group.id,
      payment(bilal.id, asha.id, 100, { occurredOn: '2027-11-12' }),
    );
    expect(res.status).toBe(201);
  });
});

describe('access', () => {
  it('is for the group’s active members only', async () => {
    const { asha, bilal, group } = await goa();
    const [stranger, leaver] = await Promise.all([person('stranger'), person('leaver')]);
    await join(asha, group.id, leaver);
    const body = payment(bilal.id, asha.id, 95_000);
    const tx = await settle(bilal, group.id, body);
    expect(
      (await ctx.call(leaver, 'DELETE', `/api/v1/groups/${group.id}/members/${leaver.id}`)).status,
    ).toBe(204);

    const anonymous = await ctx.request(`/api/v1/groups/${group.id}/settlements`, {
      method: 'POST',
      body: payment(bilal.id, asha.id, 1),
    });
    expect(anonymous.status).toBe(401);

    for (const who of [stranger, leaver]) {
      const create = await record(who, group.id, payment(bilal.id, asha.id, 1));
      expect([create.status, code(create.body)]).toEqual([404, 'NOT_FOUND']);
      // 404 whatever the body, so a stranger learns nothing from validation either.
      for (const sent of [asUpdate(body), { nonsense: true }]) {
        const res = await edit(who, tx.id, 1, sent);
        expect([res.status, code(res.body)]).toEqual([404, 'NOT_FOUND']);
      }
    }
    const badId = await edit(asha, 'not-a-uuid', 1, asUpdate(body));
    expect([badId.status, code(badId.body)]).toEqual([404, 'NOT_FOUND']);
    expect((await get(asha, `/transactions/${tx.id}`, Transaction)).version).toBe(1);
  });
});

/** A small seeded random number generator (mulberry32): the same sequence for the same seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
