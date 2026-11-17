import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_INPUT_RETENTION_DAYS, runMaintenance } from './maintenance';
import { aiRequests } from './schema';
import { createTestDatabase, insertUser, type TestDatabase } from './testing';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(() => t.drop());

describe('runMaintenance', () => {
  it(`forgets typed sentences older than ${AI_INPUT_RETENTION_DAYS} days, and only those`, async () => {
    const user = (await insertUser(t.db)).id;
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [old, recent] = await t.db
      .insert(aiRequests)
      .values([
        {
          userId: user,
          kind: 'parse_expense',
          path: 'llm',
          outcome: 'ok',
          inputText: 'dinner 2400',
          createdAt: daysAgo(31),
        },
        {
          userId: user,
          kind: 'parse_expense',
          path: 'llm',
          outcome: 'ok',
          inputText: 'cab 450',
          createdAt: daysAgo(29),
        },
      ])
      .returning({ id: aiRequests.id });
    const text = async (id: number) =>
      (await t.db.select().from(aiRequests).where(eq(aiRequests.id, id)))[0]!.inputText;

    expect(await runMaintenance(t.db)).toEqual({ aiInputsPurged: 1 });
    expect(await text(old!.id)).toBeNull();
    expect(await text(recent!.id)).toBe('cab 450');

    // Nothing left to purge.
    expect(await runMaintenance(t.db)).toEqual({ aiInputsPurged: 0 });
  });
});
