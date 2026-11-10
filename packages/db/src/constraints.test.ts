// Row-level CHECKs, uniqueness and foreign keys: the last line of defense behind zod and core.

import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError } from './client';
import {
  activityLog,
  aiRequests,
  currencies,
  directPairs,
  groupMembers,
  groups,
  invites,
  transactionPayers,
  transactions,
  users,
} from './schema';
import {
  createTestDatabase,
  insertGroup,
  insertTransaction,
  insertUser,
  type TestDatabase,
} from './testing';

let t: TestDatabase;
let a: string, b: string, groupId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  a = (await insertUser(t.db, { name: 'Asha' })).id;
  b = (await insertUser(t.db, { name: 'Bilal' })).id;
  groupId = (await insertGroup(t.db, [a, b])).id;
});
afterAll(() => t.drop());

/** Expects the write to fail on exactly this constraint. */
async function violates(write: Promise<unknown>, constraint: string) {
  const error = await write.then(
    () => expect.fail(`expected ${constraint} to reject this`),
    (e: unknown) => e,
  );
  expect(findPgError(error)?.constraint).toBe(constraint);
}

describe('users', () => {
  it.each([
    [{ name: '' }, 'users_name_length'],
    [{ name: 'x'.repeat(61) }, 'users_name_length'],
  ])('rejects %j', (values, constraint) => violates(insertUser(t.db, values), constraint));

  it('rejects a placeholder linked to an auth account', async () => {
    await t.db.execute(
      sql`INSERT INTO auth_user (id, name, email, updated_at) VALUES ('auth-1', 'X', 'x@example.com', now())`,
    );
    await violates(
      insertUser(t.db, { isPlaceholder: true, authUserId: 'auth-1' }),
      'users_placeholder_has_no_auth',
    );
  });

  it('rejects merging a user into itself', async () => {
    const id = randomUUID();
    await violates(insertUser(t.db, { id, mergedInto: id }), 'users_not_merged_into_self');
  });

  it('compares emails case-insensitively (citext)', async () => {
    const user = await insertUser(t.db, { email: 'Rahul.Sharma@Example.com' });
    const found = await t.db
      .select()
      .from(users)
      .where(eq(users.email, 'rahul.sharma@example.com'));
    expect(found.map((u) => u.id)).toEqual([user.id]);
  });

  it('rejects an unknown default currency', () =>
    violates(
      insertUser(t.db, { defaultCurrency: 'XXX' }),
      'users_default_currency_currencies_code_fk',
    ));
});

describe('currencies', () => {
  it.each([
    [{ code: 'inr', minorUnits: 2, symbol: '₹' }, 'currencies_code_format'],
    [{ code: 'ZZZ', minorUnits: 5, symbol: 'Z' }, 'currencies_minor_units_range'],
  ])('rejects %j', (values, constraint) =>
    violates(t.db.insert(currencies).values(values), constraint),
  );
});

describe('groups', () => {
  const group = (values: Partial<typeof groups.$inferInsert>) =>
    t.db.insert(groups).values({
      id: randomUUID(),
      kind: 'group',
      name: 'G',
      currency: 'INR',
      createdBy: a,
      ...values,
    });

  it('accepts a named group and an unnamed direct group', async () => {
    await group({});
    await group({ kind: 'direct', name: null });
  });

  it.each([
    [{ kind: 'team' as 'group' }, 'groups_kind'],
    // The plan's CHECK let this through: length(NULL) is NULL, which a CHECK treats as passing.
    [{ name: null }, 'groups_name'],
    [{ name: '' }, 'groups_name'],
    [{ name: 'x'.repeat(61) }, 'groups_name'],
    [{ kind: 'direct' as const, name: 'You & Bilal' }, 'groups_name'],
  ])('rejects %j', (values, constraint) => violates(group(values), constraint));
});

describe('group_members', () => {
  it('allows one active owner per group', async () => {
    const g = await insertGroup(t.db, [a, b]);
    await violates(
      t.db
        .update(groupMembers)
        .set({ role: 'owner' })
        .where(sql`${groupMembers.groupId} = ${g.id} AND ${groupMembers.userId} = ${b}`),
      'group_members_one_owner',
    );
  });

  it('allows a new owner once the old one has left', async () => {
    const g = await insertGroup(t.db, [a, b]);
    await t.db
      .update(groupMembers)
      .set({ leftAt: sql`now()` })
      .where(sql`${groupMembers.groupId} = ${g.id} AND ${groupMembers.userId} = ${a}`);
    await t.db
      .update(groupMembers)
      .set({ role: 'owner' })
      .where(sql`${groupMembers.groupId} = ${g.id} AND ${groupMembers.userId} = ${b}`);
  });

  it.each([
    [{ role: 'admin' as 'member' }, 'group_members_role'],
    [
      { joinedAt: new Date('2026-11-05'), leftAt: new Date('2026-11-04') },
      'group_members_left_after_joined',
    ],
  ])('rejects %j', async (values, constraint) => {
    const c = await insertUser(t.db);
    await violates(
      t.db.insert(groupMembers).values({ groupId, userId: c.id, ...values }),
      constraint,
    );
  });

  it('rejects a duplicate membership', () =>
    violates(
      t.db.insert(groupMembers).values({ groupId, userId: a }),
      'group_members_group_id_user_id_pk',
    ));
});

describe('direct_pairs', () => {
  it('stores each pair once, in sorted order', async () => {
    const [x, y] = [a, b].sort() as [string, string];
    const direct = await t.db
      .insert(groups)
      .values({ id: randomUUID(), kind: 'direct', currency: 'INR', createdBy: a })
      .returning();
    await t.db.insert(directPairs).values({ userLow: x, userHigh: y, groupId: direct[0]!.id });
    const other = await t.db
      .insert(groups)
      .values({ id: randomUUID(), kind: 'direct', currency: 'INR', createdBy: a })
      .returning();
    await violates(
      t.db.insert(directPairs).values({ userLow: x, userHigh: y, groupId: other[0]!.id }),
      'direct_pairs_user_low_user_high_pk',
    );
    await violates(
      t.db.insert(directPairs).values({ userLow: y, userHigh: x, groupId: other[0]!.id }),
      'direct_pairs_sorted',
    );
  });
});

describe('invites', () => {
  const invite = (tokenHash: Buffer) =>
    t.db.insert(invites).values({
      id: randomUUID(),
      groupId,
      tokenHash,
      createdBy: a,
      expiresAt: new Date('2026-12-05'),
    });

  it('stores a 32-byte hash, once', async () => {
    const hash = randomBytes(32);
    await invite(hash);
    await violates(invite(hash), 'invites_token_hash_unique');
  });

  it('rejects anything that isn’t a SHA-256 hash', () =>
    violates(invite(randomBytes(31)), 'invites_token_hash_length'));
});

describe('transactions', () => {
  const tx = (values: Partial<typeof transactions.$inferInsert>) =>
    t.db.insert(transactions).values({
      id: randomUUID(),
      groupId,
      type: 'expense',
      description: 'X',
      currency: 'INR',
      amount: 100,
      occurredOn: '2026-11-05',
      splitMethod: 'equal',
      createdBy: a,
      ...values,
    });

  it('accepts the cap exactly', async () => {
    await insertTransaction(t.db, {
      groupId,
      createdBy: a,
      amount: 10_000_000_000,
      payers: [{ userId: a, amount: 10_000_000_000 }],
      shares: [{ userId: b, amount: 10_000_000_000 }],
    });
  });

  it.each<[Partial<typeof transactions.$inferInsert>, string]>([
    [{ amount: 0 }, 'transactions_amount_range'],
    [{ amount: -100 }, 'transactions_amount_range'],
    [{ amount: 10_000_000_001 }, 'transactions_amount_range'],
    [{ description: '' }, 'transactions_description_length'],
    [{ description: 'x'.repeat(121) }, 'transactions_description_length'],
    [{ notes: 'x'.repeat(1001) }, 'transactions_notes_length'],
    [{ occurredOn: '1999-12-31' }, 'transactions_occurred_on_min'],
    [{ type: 'refund' as 'expense' }, 'transactions_type'],
    [{ splitMethod: 'itemized' as 'equal' }, 'transactions_split_method'],
    [{ source: 'email' as 'manual' }, 'transactions_source'],
    [{ version: 0 }, 'transactions_version_positive'],
    [{ splitMethod: null }, 'transactions_type_fields'],
    [{ paymentMethod: 'cash' }, 'transactions_type_fields'],
    [{ paymentRef: 'UTR123' }, 'transactions_type_fields'],
    [{ type: 'settlement', splitMethod: null, paymentMethod: null }, 'transactions_type_fields'],
    [
      { type: 'settlement', splitMethod: 'equal', paymentMethod: 'cash' },
      'transactions_type_fields',
    ],
    [
      {
        type: 'settlement',
        splitMethod: null,
        splitInput: { method: 'equal' },
        paymentMethod: 'cash',
      },
      'transactions_type_fields',
    ],
    [
      { type: 'settlement', splitMethod: null, paymentMethod: 'paypal' as 'cash' },
      'transactions_payment_method',
    ],
    [{ deletedAt: new Date() }, 'transactions_deleted_fields'],
    [{ currency: 'XXX' }, 'transactions_currency_currencies_code_fk'],
  ])('rejects %j', (values, constraint) => violates(tx(values), constraint));

  it('rejects deleted_by without deleted_at', () =>
    violates(tx({ deletedBy: a }), 'transactions_deleted_fields'));

  it('rejects a payer or share of zero', async () => {
    const id = randomUUID();
    await expect(
      t.db.transaction(async (db) => {
        await db.insert(transactions).values({
          id,
          groupId,
          type: 'expense',
          description: 'X',
          currency: 'INR',
          amount: 100,
          occurredOn: '2026-11-05',
          splitMethod: 'exact',
          createdBy: a,
        });
        await db.insert(transactionPayers).values({ transactionId: id, userId: a, amount: 0 });
      }),
    ).rejects.toSatisfy((e) => findPgError(e)?.constraint === 'transaction_payers_amount_positive');
  });

  it('rejects a payer who isn’t a user', () =>
    violates(
      insertTransaction(t.db, {
        groupId,
        createdBy: a,
        amount: 100,
        payers: [{ userId: randomUUID(), amount: 100 }],
        shares: [{ userId: a, amount: 100 }],
      }),
      'transaction_payers_user_id_users_id_fk',
    ));
});

describe('activity_log', () => {
  const entry = (values: Partial<typeof activityLog.$inferInsert>) =>
    t.db.insert(activityLog).values({
      groupId,
      actorId: a,
      verb: 'transaction.created',
      entityType: 'transaction',
      entityId: randomUUID(),
      ...values,
    });

  it.each([
    [{ entityType: 'user' as 'group' }, 'activity_log_entity_type'],
    [{ verb: 'Transaction Created' }, 'activity_log_verb_format'],
    [{ verb: 'created' }, 'activity_log_verb_format'],
  ])('rejects %j', (values, constraint) => violates(entry(values), constraint));
});

describe('ai_requests', () => {
  const request = (values: Partial<typeof aiRequests.$inferInsert>) =>
    t.db
      .insert(aiRequests)
      .values({ userId: a, kind: 'parse_expense', path: 'llm', outcome: 'ok', ...values });

  it('accepts a logged request', () =>
    request({ inputTokens: 120, outputTokens: 80, costMicros: 45 }));

  it.each([
    [{ path: 'magic' as 'llm' }, 'ai_requests_path'],
    [{ outcome: 'great' as 'ok' }, 'ai_requests_outcome'],
    [{ inputTokens: -1 }, 'ai_requests_usage_non_negative'],
    [{ costMicros: -5 }, 'ai_requests_usage_non_negative'],
  ])('rejects %j', (values, constraint) => violates(request(values), constraint));
});
