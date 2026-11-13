// Expenses end to end against a fresh database: create, replay, edit, delete, restore, list,
// history, concurrency (Blueprint 10.4 "Expense lifecycle" and "Concurrency").

import {
  DeletedTransaction,
  ErrorEnvelope,
  Group,
  GroupList,
  InviteCreated,
  Transaction,
  TransactionHistory,
  TransactionPage,
  type CreateExpense,
} from '@fairshare/contracts';
import { computeShares } from '@fairshare/core';
import { activityLog, ledger, transactions, withTx } from '@fairshare/db';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { recordActivity } from '../activity/record';
import { integrationApp } from '../../testing/integration';
import * as repo from './repo';

const ctx = await integrationApp({ clock: () => new Date('2026-11-12T10:00:00Z') });
afterAll(() => ctx.drop());

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;
type Who = { cookie: string; id: string };

/** Asha's group with two placeholders, Bilal and Chitra. */
async function goa() {
  const asha = await person('asha');
  const group = Group.parse(
    (
      await ctx.call(asha, 'POST', '/api/v1/groups', {
        id: uuidv7(),
        name: 'Goa',
        currency: 'INR',
        members: [{ name: 'Bilal' }, { name: 'Chitra' }],
      })
    ).body,
  );
  const [bilal, chitra] = group.members.slice(1).map((m) => m.user.id) as [string, string];
  return { asha, group, bilal, chitra };
}

/** Asha paid `amount` for all three, split equally. */
function dinner(asha: Who, others: string[], extra: Partial<CreateExpense> = {}): CreateExpense {
  return {
    id: uuidv7(),
    description: 'Dinner',
    amount: 1000,
    currency: 'INR',
    occurredOn: '2026-11-10',
    payers: [{ userId: asha.id, amount: extra.amount ?? 1000 }],
    split: { method: 'equal', participants: [asha.id, ...others] },
    ...extra,
  };
}

const create = (who: Who, groupId: string, body: unknown) =>
  ctx.call(who, 'POST', `/api/v1/groups/${groupId}/expenses`, body);

/** A PUT/DELETE/restore with If-Match. */
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

async function nets(groupId: string) {
  const rows = await ctx.db
    .select({ userId: ledger.userId, net: sql<string>`sum(${ledger.amount})` })
    .from(ledger)
    .where(eq(ledger.groupId, groupId))
    .groupBy(ledger.userId);
  const entries = rows
    .map((r): [string, number] => [r.userId, Number(r.net)])
    .filter(([, v]) => v !== 0);
  return Object.fromEntries(entries) as Record<string, number>;
}

describe('creating an expense', () => {
  it('computes the shares exactly as core does in the browser, and records it', async () => {
    const { asha, group, bilal, chitra } = await goa();
    const body = dinner(asha, [bilal, chitra]);

    const res = await create(asha, group.id, body);

    expect(res.status).toBe(201);
    const tx = Transaction.parse(res.body);
    expect(tx.type === 'expense' && tx.shares).toEqual(computeShares(1000, body.split, body.id));
    expect(tx).toMatchObject({
      description: 'Dinner',
      version: 1,
      myNet: 1000 - tx.shares.find((s) => s.userId === asha.id)!.amount,
      createdBy: { id: asha.id },
      updatedBy: null,
    });
    // Which of the three gets the extra paisa depends on the ID (the seed); the nets follow.
    const share = (userId: string) => tx.shares.find((l) => l.userId === userId)!.amount;
    expect(tx.shares.map((l) => l.amount).sort()).toEqual([333, 333, 334]);
    expect(await nets(group.id)).toEqual({
      [asha.id]: 1000 - share(asha.id),
      [bilal]: -share(bilal),
      [chitra]: -share(chitra),
    });
    const [entry] = await ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, body.id));
    expect(entry).toMatchObject({ verb: 'transaction.created', actorId: asha.id, before: null });
    expect(entry!.after).toMatchObject({ description: 'Dinner', amount: 1000 });
  });

  it('refuses another currency, people outside the group, and people who left', async () => {
    const { asha, group, bilal, chitra } = await goa();
    const stranger = await person('stranger');
    await create(asha, group.id, dinner(asha, [bilal])); // keeps Chitra settled
    await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${chitra}`);

    const cases = [
      [dinner(asha, [bilal], { currency: 'USD' }), 'CURRENCY_MISMATCH'],
      [dinner(asha, [stranger.id]), 'NOT_A_MEMBER'],
      [dinner(asha, [chitra]), 'MEMBER_INACTIVE'],
    ] as const;
    for (const [body, expected] of cases) {
      const res = await create(asha, group.id, body);
      expect(res.status, expected).toBe(422);
      expect(code(res.body)).toBe(expected);
    }
  });

  it('refuses sums that don’t add up, with core’s codes', async () => {
    const { asha, group, bilal } = await goa();

    const payers = await create(asha, group.id, {
      ...dinner(asha, [bilal]),
      payers: [{ userId: asha.id, amount: 900 }],
    });
    const exact = await create(asha, group.id, {
      ...dinner(asha, [bilal]),
      split: {
        method: 'exact',
        amounts: [
          { userId: asha.id, amount: 500 },
          { userId: bilal, amount: 400 },
        ],
      },
    });

    expect([payers.status, code(payers.body)]).toEqual([422, 'PAYER_SUM_MISMATCH']);
    expect([exact.status, code(exact.body)]).toEqual([422, 'SPLIT_SUM_MISMATCH']);
    expect(ErrorEnvelope.parse(exact.body).error.details).toEqual({ expected: 1000, actual: 900 });
  });

  it('accepts a date up to a year ahead, and rejects one further out', async () => {
    const { asha, group, bilal } = await goa();
    expect(
      (await create(asha, group.id, dinner(asha, [bilal], { occurredOn: '2027-11-12' }))).status,
    ).toBe(201);
    const late = await create(asha, group.id, dinner(asha, [bilal], { occurredOn: '2027-11-13' }));
    expect(late.status).toBe(400);
  });

  it('rejects an AI request ID that isn’t mine', async () => {
    const { asha, group, bilal } = await goa();
    const res = await create(asha, group.id, dinner(asha, [bilal], { aiRequestId: 999_999 }));
    expect(res.status).toBe(400);
  });
});

describe('every split method and several payers (Phase 11)', () => {
  // ₹1,200 among Asha, Bilal and Chitra, paid by Asha (₹1,000) and Bilal (₹200).
  const cases = (
    asha: string,
    bilal: string,
    chitra: string,
  ): [string, CreateExpense['split']][] => [
    [
      'exact',
      {
        method: 'exact',
        amounts: [
          { userId: asha, amount: 700 },
          { userId: chitra, amount: 500 },
        ],
      },
    ],
    [
      'percent',
      {
        method: 'percent',
        basisPoints: [
          { userId: chitra, bp: 3333 },
          { userId: bilal, bp: 3333 },
          { userId: asha, bp: 3334 },
        ],
      },
    ],
    [
      'shares',
      {
        method: 'shares',
        shares: [
          { userId: bilal, shares: 1 },
          { userId: asha, shares: 2 },
          { userId: chitra, shares: 0 },
        ],
      },
    ],
  ];

  it('saves each as computed, replays it (200), and treats an unchanged edit as a no-op', async () => {
    const { asha, group, bilal, chitra } = await goa();
    for (const [method, split] of cases(asha.id, bilal, chitra)) {
      const body = dinner(asha, [bilal, chitra], {
        amount: 1200,
        payers: [
          { userId: asha.id, amount: 1000 },
          { userId: bilal, amount: 200 },
        ],
        split,
      });

      const created = await create(asha, group.id, body);
      expect(created.status, method).toBe(201);
      const tx = Transaction.parse(created.body);
      expect(tx.type === 'expense' && tx.shares, method).toEqual(
        computeShares(1200, split, body.id),
      );
      expect(tx.payers, method).toEqual(
        [
          { userId: asha.id, amount: 1000 },
          { userId: bilal, amount: 200 },
        ].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
      );

      // The same request again: the stored one, not a conflict.
      const replay = await create(asha, group.id, body);
      expect([replay.status, Transaction.parse(replay.body).version], method).toEqual([200, 1]);

      // The same expense sent back as an edit (entries in another order): nothing changes.
      const { id: _id, ...update } = body;
      const reordered = {
        ...update,
        split: reverseEntries(split),
        payers: [...update.payers].reverse(),
      };
      const unchanged = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, reordered);
      expect([unchanged.status, Transaction.parse(unchanged.body).version], method).toEqual([
        200, 1,
      ]);
      const entries = await ctx.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, body.id));
      expect(
        entries.map((e) => e.verb),
        method,
      ).toEqual(['transaction.created']);
    }
  });
});

/** The same split with its entries listed the other way round. */
function reverseEntries(split: CreateExpense['split']): CreateExpense['split'] {
  switch (split.method) {
    case 'equal':
      return { ...split, participants: [...split.participants].reverse() };
    case 'exact':
      return { ...split, amounts: [...split.amounts].reverse() };
    case 'percent':
      return { ...split, basisPoints: [...split.basisPoints].reverse() };
    case 'shares':
      return { ...split, shares: [...split.shares].reverse() };
  }
}

describe('idempotency (C6)', () => {
  it('replays the same body (200), and refuses a different body or creator with the ID (409)', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    const first = await create(asha, group.id, body);
    const other = await person('other');

    const same = await create(asha, group.id, body);
    const changed = await create(asha, group.id, { ...body, description: 'Lunch' });
    const elsewhere = await create(other, group.id, body);

    expect(same.status).toBe(200);
    expect(Transaction.parse(same.body)).toEqual(Transaction.parse(first.body));
    expect([changed.status, code(changed.body)]).toEqual([409, 'ID_CONFLICT']);
    expect(elsewhere.status).toBe(404); // not a member of the group at all
    const rows = await ctx.db.select().from(transactions).where(eq(transactions.id, body.id));
    expect(rows).toHaveLength(1);
  });

  it('stores one expense when the same create arrives twice at once', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);

    const results = await Promise.all([create(asha, group.id, body), create(asha, group.id, body)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const log = await ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, body.id))
      .orderBy(asc(activityLog.id));
    expect(log).toHaveLength(1);
  });
});

describe('editing', () => {
  it('replaces the expense, bumps the version and records before and after', async () => {
    const { asha, group, bilal, chitra } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const { id: _, ...update } = {
      ...body,
      amount: 1500,
      payers: [{ userId: asha.id, amount: 1500 }],
    };

    const res = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, {
      ...update,
      split: { method: 'equal', participants: [asha.id, bilal, chitra] },
    });

    expect(res.status).toBe(200);
    expect(Transaction.parse(res.body)).toMatchObject({
      amount: 1500,
      version: 2,
      updatedBy: { id: asha.id },
    });
    const log = await ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, body.id))
      .orderBy(asc(activityLog.id));
    expect(log.at(-1)).toMatchObject({ verb: 'transaction.updated' });
    expect(log.at(-1)!.before).toMatchObject({ amount: 1000 });
    expect(log.at(-1)!.after).toMatchObject({ amount: 1500 });
  });

  it('lets any member edit, not only whoever added it', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const dev = await person('dev');
    const invite = InviteCreated.parse(
      (await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/invites`, {})).body,
    );
    await ctx.call(dev, 'POST', `/api/v1/invites/${invite.url.split('/').pop()}/accept`, {});
    const { id: _, ...update } = { ...body, description: 'Dinner (edited)' };

    const res = await write(dev, 'PUT', `/api/v1/transactions/${body.id}`, 1, update);

    expect(Transaction.parse(res.body)).toMatchObject({ updatedBy: { id: dev.id } });
  });

  it('answers a stale version with 409 and the current one, and a missing If-Match with 428', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const { id: _, ...update } = body;
    await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, { ...update, notes: 'x' });

    const stale = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, update);
    const missing = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, null, update);

    expect(stale.status).toBe(409);
    expect(ErrorEnvelope.parse(stale.body).error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 2 },
    });
    expect([missing.status, code(missing.body)]).toEqual([428, 'IF_MATCH_REQUIRED']);
  });

  it('changes nothing when the body is the same', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const { id: _, ...update } = body;

    const res = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, update);

    expect(Transaction.parse(res.body).version).toBe(1);
    const log = await ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, body.id))
      .orderBy(asc(activityLog.id));
    expect(log).toHaveLength(1);
  });

  it('lets exactly one of two simultaneous edits of one version win', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const { id: _, ...update } = body;

    const results = await Promise.all([
      write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, { ...update, description: 'A' }),
      write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, { ...update, description: 'B' }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await ctx.db.select().from(transactions).where(eq(transactions.id, body.id));
    expect(row!.version).toBe(2);
  });

  it('refuses a deleted expense until it’s restored', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 1);
    const { id: _, ...update } = body;

    const res = await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 2, update);

    expect([res.status, code(res.body)]).toEqual([409, 'TRANSACTION_DELETED']);
  });
});

describe('deleting and restoring', () => {
  it('drops the expense from balances, and restore brings it back', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const myNet = async () =>
      GroupList.parse((await ctx.call(asha, 'GET', '/api/v1/groups')).body).items.find(
        (g) => g.id === group.id,
      )!.myNet;
    expect(await myNet()).toEqual([{ amount: 500, currency: 'INR' }]);

    const deleted = await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 1);
    expect(DeletedTransaction.parse(deleted.body).version).toBe(2);
    expect(await myNet()).toEqual([]);
    const again = await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 2);
    expect(DeletedTransaction.parse(again.body).version).toBe(2); // already deleted: unchanged

    const restored = await write(asha, 'POST', `/api/v1/transactions/${body.id}/restore`, 2);
    expect(Transaction.parse(restored.body)).toMatchObject({ version: 3, deletedAt: null });
    expect(await myNet()).toEqual([{ amount: 500, currency: 'INR' }]);
  });

  it('refuses to restore once someone in it has left (422 MEMBER_INACTIVE)', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 1);
    // With the expense deleted Bilal is settled, so he can be removed.
    await ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${bilal}`);

    const res = await write(asha, 'POST', `/api/v1/transactions/${body.id}/restore`, 2);

    expect([res.status, code(res.body)]).toEqual([422, 'MEMBER_INACTIVE']);
  });

  it('keeps deleted expenses readable, for the restore button', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 1);

    const res = await ctx.call(asha, 'GET', `/api/v1/transactions/${body.id}`);

    expect(Transaction.parse(res.body).deletedAt).not.toBeNull();
  });
});

describe('the list', () => {
  async function seeded() {
    const g = await goa();
    const add = (extra: Partial<CreateExpense>, others = [g.bilal]) =>
      create(g.asha, g.group.id, dinner(g.asha, others, extra));
    return { ...g, add };
  }

  it('is newest first, by date then ID, across pages, and stable while expenses are added', async () => {
    const { asha, group, add } = await seeded();
    for (const day of ['2026-11-01', '2026-11-03', '2026-11-03', '2026-11-02', '2026-11-05']) {
      await add({ occurredOn: day });
    }
    const all = TransactionPage.parse(
      (await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/transactions`)).body,
    ).items;

    const first = TransactionPage.parse(
      (await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/transactions?limit=2`)).body,
    );
    await add({ occurredOn: '2026-11-04' }); // lands before the cursor: must not shift page 2
    const second = TransactionPage.parse(
      (
        await ctx.call(
          asha,
          'GET',
          `/api/v1/groups/${group.id}/transactions?limit=10&cursor=${first.nextCursor}`,
        )
      ).body,
    );

    expect(all.map((t) => t.occurredOn)).toEqual([
      '2026-11-05',
      '2026-11-03',
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
    ]);
    expect(all[1]!.id > all[2]!.id).toBe(true);
    expect([...first.items, ...second.items].map((t) => t.id)).toEqual(all.map((t) => t.id));
    expect(second.nextCursor).toBeNull();
  });

  it('combines filters and search, and shows deleted ones only when asked', async () => {
    const { asha, group, chitra, add } = await seeded();
    await add({ description: 'Taxi to airport', occurredOn: '2026-11-02' });
    await add({ description: 'Taxi home', occurredOn: '2026-11-08' }, [chitra]);
    await add({ description: 'Dinner', notes: 'taxi money included', occurredOn: '2026-11-09' }, [
      chitra,
    ]);
    const gone = dinner(asha, [chitra], {
      description: 'Taxi (deleted)',
      occurredOn: '2026-11-09',
    });
    await create(asha, group.id, gone);
    await write(asha, 'DELETE', `/api/v1/transactions/${gone.id}`, 1);
    const list = async (query: string) =>
      TransactionPage.parse(
        (await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/transactions?${query}`)).body,
      ).items.map((t) => t.description);

    expect(await list('q=taxi')).toEqual(['Dinner', 'Taxi home', 'Taxi to airport']);
    expect(await list(`q=taxi&person=${chitra}&from=2026-11-05`)).toEqual(['Dinner', 'Taxi home']);
    expect(await list('q=taxi&to=2026-11-05')).toEqual(['Taxi to airport']);
    expect(await list('q=taxi&includeDeleted=true')).toContain('Taxi (deleted)');
    expect(await list('type=settlement')).toEqual([]);
  });

  it('pages a list filtered by type, person and dates together, deleted ones included', async () => {
    const { asha, group, bilal, chitra, add } = await seeded();
    const pay = async (from: string, occurredOn: string) => {
      const body = {
        id: uuidv7(),
        fromUserId: from,
        toUserId: asha.id,
        amount: 100,
        currency: 'INR',
        occurredOn,
        method: 'cash',
      };
      const res = await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/settlements`, body);
      expect(res.status).toBe(201);
      return body.id;
    };
    await add({ occurredOn: '2026-11-04' }, [chitra]); // an expense: wrong type
    await pay(chitra, '2026-11-01'); // before the range
    const first = await pay(chitra, '2026-11-03');
    await pay(bilal, '2026-11-04'); // someone else's payment
    const second = await pay(chitra, '2026-11-06');
    const gone = await pay(chitra, '2026-11-07');
    await write(asha, 'DELETE', `/api/v1/transactions/${gone}`, 1);
    await pay(chitra, '2026-11-09'); // after the range

    const query = `type=settlement&person=${chitra}&from=2026-11-02&to=2026-11-08`;
    const pages = async (extra: string) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await ctx.call(
          asha,
          'GET',
          `/api/v1/groups/${group.id}/transactions?${query}&${extra}&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        const page = TransactionPage.parse(res.body);
        ids.push(...page.items.map((t) => t.id));
        cursor = page.nextCursor;
      } while (cursor);
      return ids;
    };

    expect(await pages('includeDeleted=false')).toEqual([second, first]);
    expect(await pages('includeDeleted=true')).toEqual([gone, second, first]);
  });

  it('matches % and _ in a search literally, not as wildcards', async () => {
    const { asha, group, add } = await seeded();
    await add({ description: 'Shirts at 50% off' });
    await add({ description: 'Taxi 500' });
    await add({ description: 'wifi_bill' });
    await add({ description: 'wifi-bill' });
    const list = async (q: string) =>
      TransactionPage.parse(
        (
          await ctx.call(
            asha,
            'GET',
            `/api/v1/groups/${group.id}/transactions?q=${encodeURIComponent(q)}`,
          )
        ).body,
      ).items.map((t) => t.description);

    expect(await list('50%')).toEqual(['Shirts at 50% off']);
    expect(await list('i_b')).toEqual(['wifi_bill']);
  });

  it('rejects a malformed cursor and a reversed date range', async () => {
    const { asha, group } = await seeded();
    for (const query of ['cursor=nonsense', 'from=2026-11-05&to=2026-11-01']) {
      const res = await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/transactions?${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});

describe('history', () => {
  it('lists every change oldest first, marking the ones that involve me', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const { id: _, ...update } = body;
    await write(asha, 'PUT', `/api/v1/transactions/${body.id}`, 1, {
      ...update,
      amount: 2000,
      payers: [{ userId: asha.id, amount: 2000 }],
    });
    await write(asha, 'DELETE', `/api/v1/transactions/${body.id}`, 2);

    const { items } = TransactionHistory.parse(
      (await ctx.call(asha, 'GET', `/api/v1/transactions/${body.id}/history`)).body,
    );

    expect(items.map((e) => [e.verb, e.actor.id, e.groupName, e.involvesMe])).toEqual([
      ['transaction.created', asha.id, 'Goa', true],
      ['transaction.updated', asha.id, 'Goa', true],
      ['transaction.deleted', asha.id, 'Goa', true],
    ]);
  });
});

describe('concurrency', () => {
  it('keeps all 20 expenses created at once, and the nets still sum to zero', async () => {
    const { asha, group, bilal, chitra } = await goa();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        create(
          asha,
          group.id,
          dinner(asha, [bilal, chitra], {
            amount: 1000 + i,
            payers: [{ userId: asha.id, amount: 1000 + i }],
          }),
        ),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    const page = TransactionPage.parse(
      (await ctx.call(asha, 'GET', `/api/v1/groups/${group.id}/transactions?limit=50`)).body,
    );
    expect(page.items).toHaveLength(20);
    expect(Object.values(await nets(group.id)).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('an expense racing a member’s removal', () => {
  it('never lets both succeed: the member never leaves owing money', async () => {
    for (let round = 0; round < 5; round++) {
      const { asha, group, bilal } = await goa();
      await Promise.all(Array.from({ length: 5 }, () => ctx.pool.query('SELECT pg_sleep(0.02)')));

      const [added, removed] = await Promise.all([
        create(asha, group.id, dinner(asha, [bilal])),
        ctx.call(asha, 'DELETE', `/api/v1/groups/${group.id}/members/${bilal}`),
      ]);

      const outcome = [added.status, removed.status];
      // Expense first: the removal sees a balance. Removal first: the expense sees a former member.
      expect([JSON.stringify([201, 409]), JSON.stringify([422, 204])]).toContain(
        JSON.stringify(outcome),
      );
    }
  });
});

describe('database transactions', () => {
  it('roll back the expense and its activity together when a later write fails', async () => {
    const { asha, group } = await goa();
    const id = uuidv7();

    const attempt = withTx(ctx.db, async (tx) => {
      await tx.insert(transactions).values({
        id,
        groupId: group.id,
        type: 'expense',
        description: 'Half-written',
        currency: 'INR',
        amount: 100,
        occurredOn: '2026-11-10',
        splitMethod: 'equal',
        createdBy: asha.id,
      });
      await recordActivity(tx, {
        groupId: group.id,
        actorId: asha.id,
        verb: 'transaction.created',
        entityType: 'transaction',
        entityId: id,
      });
      // A share for someone who doesn't exist: the foreign key fails.
      await repo.replaceLines(tx, id, {
        payers: [{ userId: asha.id, amount: 100 }],
        shares: [{ userId: uuidv7(), amount: 100 }],
      });
    });

    await expect(attempt).rejects.toThrow();
    expect(await ctx.db.select().from(transactions).where(eq(transactions.id, id))).toHaveLength(0);
    expect(
      await ctx.db.select().from(activityLog).where(eq(activityLog.entityId, id)),
    ).toHaveLength(0);
  });
});

describe('access', () => {
  it('is for the group’s active members only: others get 404, signed-out 401', async () => {
    const { asha, group, bilal } = await goa();
    const body = dinner(asha, [bilal]);
    await create(asha, group.id, body);
    const outsider = await person('outsider');
    const former = await person('former');
    const invite = InviteCreated.parse(
      (await ctx.call(asha, 'POST', `/api/v1/groups/${group.id}/invites`, {})).body,
    );
    await ctx.call(former, 'POST', `/api/v1/invites/${invite.url.split('/').pop()}/accept`, {});
    await ctx.call(former, 'DELETE', `/api/v1/groups/${group.id}/members/me`);
    const { id: _, ...update } = body;

    for (const who of [outsider, former]) {
      expect((await ctx.call(who, 'GET', `/api/v1/transactions/${body.id}`)).status).toBe(404);
      expect((await ctx.call(who, 'GET', `/api/v1/transactions/${body.id}/history`)).status).toBe(
        404,
      );
      expect((await write(who, 'PUT', `/api/v1/transactions/${body.id}`, 1, update)).status).toBe(
        404,
      );
      expect((await write(who, 'DELETE', `/api/v1/transactions/${body.id}`, 1)).status).toBe(404);
      expect((await write(who, 'POST', `/api/v1/transactions/${body.id}/restore`, 1)).status).toBe(
        404,
      );
      expect((await ctx.call(who, 'GET', `/api/v1/groups/${group.id}/transactions`)).status).toBe(
        404,
      );
      expect((await create(who, group.id, dinner(who, []))).status).toBe(404);
    }
    expect((await ctx.call(null, 'GET', `/api/v1/transactions/${body.id}`)).status).toBe(401);
    expect((await ctx.call(asha, 'GET', '/api/v1/transactions/not-a-uuid')).status).toBe(404);
  });
});
