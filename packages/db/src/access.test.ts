// Roles, grants and the append-only activity log (I11).

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPgError } from './client';
import { activityLog } from './schema';
import { createTestDatabase, insertGroup, insertUser, type TestDatabase } from './testing';

let t: TestDatabase;
let a: string, groupId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  a = (await insertUser(t.db)).id;
  groupId = (await insertGroup(t.db, [a])).id;
});
afterAll(() => t.drop());

const logEntry = async () => {
  const [row] = await t.db
    .insert(activityLog)
    .values({ groupId, actorId: a, verb: 'group.created', entityType: 'group', entityId: groupId })
    .returning();
  return row!;
};

/** Runs statements as `role` in a transaction that's always rolled back. */
async function asRole(role: string, statement: string, params: unknown[] = []) {
  const client = await t.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    return await client.query(statement, params);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

const errorCode = (promise: Promise<unknown>) =>
  promise.then(
    () => 'succeeded',
    (e: unknown) => findPgError(e)?.code,
  );

describe('activity_log is append-only', () => {
  it('accepts inserts', async () => {
    expect((await logEntry()).id).toBeGreaterThan(0);
  });

  it('rejects UPDATE, DELETE and TRUNCATE even from the table owner', async () => {
    const entry = await logEntry();
    expect(
      await errorCode(
        t.db.update(activityLog).set({ verb: 'group.renamed' }).where(eq(activityLog.id, entry.id)),
      ),
    ).toBe('42501');
    expect(await errorCode(t.db.delete(activityLog).where(eq(activityLog.id, entry.id)))).toBe(
      '42501',
    );
    expect(await errorCode(t.db.execute(sql`TRUNCATE activity_log`))).toBe('42501');
    const [still] = await t.db.select().from(activityLog).where(eq(activityLog.id, entry.id));
    expect(still?.verb).toBe('group.created');
  });
});

describe('fairshare_app', () => {
  it('can insert activity but not change it', async () => {
    const insert = `INSERT INTO activity_log (group_id, actor_id, verb, entity_type, entity_id)
                    VALUES ($1, $2, 'group.created', 'group', $1)`;
    expect(await errorCode(asRole('fairshare_app', insert, [groupId, a]))).toBe('succeeded');
    expect(await errorCode(asRole('fairshare_app', 'UPDATE activity_log SET verb = verb'))).toBe(
      '42501',
    );
  });

  it('soft-deletes transactions rather than deleting them', async () => {
    expect(await errorCode(asRole('fairshare_app', 'SELECT count(*) FROM ledger'))).toBe(
      'succeeded',
    );
    expect(
      await errorCode(asRole('fairshare_app', 'UPDATE transactions SET deleted_at = deleted_at')),
    ).toBe('succeeded');
    expect(await errorCode(asRole('fairshare_app', 'DELETE FROM transactions'))).toBe('42501');
  });

  it('cannot change reference data', async () => {
    expect(await errorCode(asRole('fairshare_app', "UPDATE currencies SET symbol = 'x'"))).toBe(
      '42501',
    );
  });
});

describe('fairshare_readonly', () => {
  it('reads everything and writes nothing', async () => {
    expect(await errorCode(asRole('fairshare_readonly', 'SELECT count(*) FROM ledger'))).toBe(
      'succeeded',
    );
    expect(await errorCode(asRole('fairshare_readonly', 'SELECT count(*) FROM auth_session'))).toBe(
      'succeeded',
    );
    expect(
      await errorCode(
        asRole('fairshare_readonly', 'INSERT INTO users (id, name) VALUES ($1, $2)', [
          randomUUID(),
          'X',
        ]),
      ),
    ).toBe('42501');
  });
});

describe('privilege matrix', () => {
  type Grant = { table: string; privileges: string };

  async function grantsFor(role: string): Promise<Record<string, string>> {
    const { rows } = await t.pool.query<Grant>(
      `SELECT c.relname AS table,
              concat_ws(',',
                CASE WHEN has_table_privilege($1, c.oid, 'SELECT') THEN 'SELECT' END,
                CASE WHEN has_table_privilege($1, c.oid, 'INSERT') THEN 'INSERT' END,
                CASE WHEN has_table_privilege($1, c.oid, 'UPDATE') THEN 'UPDATE' END,
                CASE WHEN has_table_privilege($1, c.oid, 'DELETE') THEN 'DELETE' END,
                CASE WHEN has_table_privilege($1, c.oid, 'TRUNCATE') THEN 'TRUNCATE' END
              ) AS privileges
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       ORDER BY 1`,
      [role],
    );
    return Object.fromEntries(rows.map((r) => [r.table, r.privileges]));
  }

  // A new table without a grant makes this fail, so a migration can't forget one.
  it('fairshare_app has exactly the intended privileges on every table', async () => {
    const all = 'SELECT,INSERT,UPDATE,DELETE';
    const noDelete = 'SELECT,INSERT,UPDATE';
    expect(await grantsFor('fairshare_app')).toEqual({
      activity_log: 'SELECT,INSERT',
      ai_requests: noDelete,
      auth_account: all,
      auth_session: all,
      auth_user: all,
      auth_verification: all,
      currencies: 'SELECT',
      direct_pairs: all,
      group_members: noDelete,
      groups: noDelete,
      invites: noDelete,
      ledger: 'SELECT',
      transaction_payers: all,
      transaction_shares: all,
      transactions: noDelete,
      users: noDelete,
    });
  });

  it('fairshare_readonly can only SELECT, everywhere', async () => {
    const grants = await grantsFor('fairshare_readonly');
    expect(Object.keys(grants)).toHaveLength(16);
    for (const privileges of Object.values(grants)) expect(privileges).toBe('SELECT');
  });

  it('fairshare_app can draw IDs from the sequences it needs', async () => {
    const { rows } = await t.pool.query<{ seq: string; ok: boolean }>(
      `SELECT c.relname AS seq, has_sequence_privilege('fairshare_app', c.oid, 'USAGE') AS ok
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`,
    );
    expect(rows).toEqual([
      { seq: 'activity_log_id_seq', ok: true },
      { seq: 'ai_requests_id_seq', ok: true },
    ]);
  });
});
