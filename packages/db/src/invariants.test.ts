// The nightly invariant check: silent on a correct database, and it finds each kind of corruption.
// Corruption has to get past the commit-time triggers, so it's written with triggers switched off
// (session_replication_role = replica, which the test database's superuser may set). The tests
// share one database (cloning one per test is slow when every package's tests run at once), so
// each puts back what it broke before it ends.

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client';
import { checkInvariants, isClean, summarize } from './invariants';
import {
  createTestDatabase,
  insertGroup,
  insertTransaction,
  insertUser,
  type TestDatabase,
} from './testing';

let t: TestDatabase;
let a: string, b: string, groupId: string, transactionId: string;

// A and B in a group, and one correct expense: A paid 2,000, split equally.
beforeAll(async () => {
  t = await createTestDatabase();
  a = (await insertUser(t.db, { name: 'A' })).id;
  b = (await insertUser(t.db, { name: 'B' })).id;
  groupId = (await insertGroup(t.db, [a, b])).id;
  transactionId = await insertTransaction(t.db, {
    groupId,
    createdBy: a,
    amount: 2000,
    payers: [{ userId: a, amount: 2000 }],
    shares: [
      { userId: a, amount: 1000 },
      { userId: b, amount: 1000 },
    ],
  });
});
afterAll(() => t.drop());

/** Runs one statement with the commit-time triggers off, as only a bug or a hand edit could. */
async function withoutTriggers(text: string, values: unknown[]) {
  const client = await t.pool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query(text, values);
  } finally {
    await client.query('SET session_replication_role = DEFAULT');
    client.release();
  }
}

describe('checkInvariants', () => {
  it('finds nothing on a correct database', async () => {
    const report = await checkInvariants(t.db);
    expect(report).toEqual({ transactionSums: [], groupNets: [], inactiveMembers: [] });
    expect(isClean(report)).toBe(true);
  });

  it('finds a transaction whose shares don’t add up, and the group nets it unbalances', async () => {
    const share =
      'UPDATE transaction_shares SET amount = amount + $3 WHERE transaction_id = $1 AND user_id = $2';
    await withoutTriggers(share, [transactionId, b, 1]);
    try {
      const report = await checkInvariants(t.db);
      expect(report.transactionSums).toEqual([
        { transactionId, amount: 2000, paid: 2000, shared: 2001 },
      ]);
      expect(report.groupNets).toEqual([{ groupId, currency: 'INR', total: -1 }]);
      expect(summarize(report)).toEqual({ transactionSums: 1, groupNets: 1, inactiveMembers: 0 });
      expect(isClean(report)).toBe(false);
    } finally {
      await withoutTriggers(share, [transactionId, b, -1]);
    }
    expect(isClean(await checkInvariants(t.db))).toBe(true);
  });

  it('finds a live transaction written after someone in it left, and only that', async () => {
    // B joined four days ago and left yesterday; the expense was created while B was a member,
    // then edited (or restored) today, after B left.
    await t.pool.query(
      `UPDATE group_members
       SET joined_at = now() - interval '4 days', left_at = now() - interval '1 day'
       WHERE group_id = $1 AND user_id = $2`,
      [groupId, b],
    );
    await t.pool.query(
      `UPDATE transactions SET created_at = now() - interval '3 days', updated_at = now()
       WHERE id = $1`,
      [transactionId],
    );
    try {
      expect((await checkInvariants(t.db)).inactiveMembers).toEqual([{ transactionId, userId: b }]);

      // Not edited since it was created, before B left: history, and fine.
      await t.pool.query('UPDATE transactions SET updated_at = NULL WHERE id = $1', [
        transactionId,
      ]);
      expect((await checkInvariants(t.db)).inactiveMembers).toEqual([]);
    } finally {
      await t.pool.query(
        'UPDATE group_members SET left_at = NULL WHERE group_id = $1 AND user_id = $2',
        [groupId, b],
      );
    }
  });

  it('needs nothing more than the read-only role, which can’t write', async () => {
    // As in production: a login role whose only rights come from fairshare_readonly.
    const role = `invariants_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(12).toString('hex');
    await t.pool.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' IN ROLE fairshare_readonly`,
    );
    const url = new URL(t.url);
    url.username = role;
    url.password = password;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
    try {
      expect(isClean(await checkInvariants(createDb(pool)))).toBe(true);
      await expect(
        pool.query('UPDATE users SET name = $1 WHERE id = $2', ['X', a]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await pool.end();
      await t.pool.query(`DROP ROLE ${role}`);
    }
  });
});
