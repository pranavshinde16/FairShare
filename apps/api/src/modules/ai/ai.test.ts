// POST /ai/parse-expense against a real database, with fake providers (Blueprint 10.4 "AI"): the
// rules path, the LLM path, invalid output and timeouts falling back, the provider chain, the
// per-person limits, the budget and token caps, name resolutions and group selection.

import { ErrorEnvelope, Group, ParseResult, type LlmExpenseExtraction } from '@fairshare/contracts';
import { aiRequests, transactions } from '@fairshare/db';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../lib/rate-limit';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';
import type { StructuredRequest } from './provider';
import { createFakeProvider, type FakeAnswer } from './providers/fake';
import { PARSE_EXPENSE_PROMPT_VERSION } from './prompts/parse-expense.v1';
import { AI_CALLS_PER_USER_PER_DAY, type AiConfig } from './service';

const TODAY = '2026-11-16';

/** What each fake answers; tests set them. */
let primaryAnswer: (request: StructuredRequest) => FakeAnswer = () => ({ fail: 'error' });
let fallbackAnswer: (request: StructuredRequest) => FakeAnswer = () => ({ fail: 'error' });
const primary = createFakeProvider('groq', (r) => primaryAnswer(r));
const fallback = createFakeProvider('cloudflare', (r) => fallbackAnswer(r));
const config: AiConfig = {
  enabled: true,
  timeoutMs: 8000,
  providers: [
    { provider: primary, textModel: 'primary-model' },
    { provider: fallback, textModel: 'fallback-model' },
  ],
};

const ctx = await integrationApp({ ai: config, clock: () => new Date(`${TODAY}T10:00:00Z`) });
afterAll(() => ctx.drop());

beforeEach(() => {
  primary.requests.length = 0;
  fallback.requests.length = 0;
  config.enabled = true;
  delete config.dailyBudgetMicros;
  for (const setup of config.providers) {
    delete setup.dailyTokens;
    delete setup.price;
  }
  primaryAnswer = () => ({ fail: 'error' });
  fallbackAnswer = () => ({ fail: 'error' });
});

let n = 0;
const person = (name: string) => ctx.person(`${name}+${++n}@example.com`);
type Who = { cookie: string; id: string };
const code = (body: unknown) => ErrorEnvelope.parse(body).error.code;

async function groupWith(owner: Who, members: string[], name = 'Goa Trip') {
  const res = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id: uuidv7(),
    name,
    currency: 'INR',
    members: members.map((m) => ({ name: m })),
  });
  return Group.parse(res.body);
}
const idOf = (group: Group, name: string) =>
  group.members.find((m) => m.user.name === name)!.user.id;

async function parse(who: Who, text: string, groupId?: string) {
  const res = await ctx.call(who, 'POST', '/api/v1/ai/parse-expense', {
    text,
    today: TODAY,
    ...(groupId && { groupId }),
  });
  return { status: res.status, body: res.body };
}
async function parsed(who: Who, text: string, groupId?: string) {
  const res = await parse(who, text, groupId);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ParseResult.parse(res.body);
}

const extraction = (patch: Partial<LlmExpenseExtraction> = {}): LlmExpenseExtraction => ({
  amount: '2400',
  currency: null,
  description: 'Dinner',
  date: null,
  payer: { kind: 'me', name: null },
  people: [],
  includesEveryone: false,
  split: { method: 'equal', values: null },
  category: 'Food',
  notes: null,
  ...patch,
});

const rowsFor = (userId: string) =>
  ctx.db.select().from(aiRequests).where(eq(aiRequests.userId, userId)).orderBy(asc(aiRequests.id));

describe('the rules path', () => {
  it('reads a simple sentence without calling a model, and logs nothing', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal', 'Chitra']);

    const result = await parsed(asha, 'I paid 2400 for dinner with Bilal', goa.id);

    expect(result).toEqual({
      requestId: null,
      path: 'rules',
      groupId: goa.id,
      draft: {
        amount: 240_000,
        description: 'Dinner',
        occurredOn: null,
        payerId: asha.id,
        splitMethod: 'equal',
        split: { method: 'equal', participants: [asha.id, idOf(goa, 'Bilal')] },
      },
      resolutions: [
        {
          name: 'Bilal',
          role: 'participant',
          value: null,
          status: 'resolved',
          userId: idOf(goa, 'Bilal'),
        },
      ],
      issues: [],
    });
    expect(primary.requests).toHaveLength(0);
    expect(await rowsFor(asha.id)).toHaveLength(0);
  });
});

describe('the LLM path', () => {
  it('reads Hinglish through the model, and logs the call', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal', 'Chitra']);
    primaryAnswer = () => ({
      output: extraction({ includesEveryone: true }),
      inputTokens: 640,
      outputTokens: 90,
    });

    const result = await parsed(asha, 'dinner ka 2400 maine diya, sab mein barabar', goa.id);

    const [row] = await rowsFor(asha.id);
    expect(result).toEqual({
      requestId: row!.id,
      path: 'llm',
      groupId: goa.id,
      draft: {
        amount: 240_000,
        description: 'Dinner',
        occurredOn: null,
        payerId: asha.id,
        splitMethod: 'equal',
        split: {
          method: 'equal',
          participants: [asha.id, idOf(goa, 'Bilal'), idOf(goa, 'Chitra')],
        },
      },
      resolutions: [],
      issues: [],
    });
    expect(row).toMatchObject({
      kind: 'parse_expense',
      path: 'llm',
      provider: 'groq',
      model: 'primary-model',
      promptVersion: PARSE_EXPENSE_PROMPT_VERSION,
      inputText: 'dinner ka 2400 maine diya, sab mein barabar',
      inputTokens: 640,
      outputTokens: 90,
      costMicros: 0,
      outcome: 'ok',
    });
  });

  it('tells the model only the sentence, today, the currency and the writer’s name (C7)', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal Khan', 'Chitra Rao']);
    primaryAnswer = () => ({ output: extraction() });

    await parsed(asha, 'Bilal ne cab ke 450 diye', goa.id);

    const [request] = primary.requests;
    expect(request!.user).toBe(
      `Today: ${TODAY}\nGroup currency: INR\nWriter: Asha\nMessage: """Bilal ne cab ke 450 diye"""`,
    );
    expect(request!.system).not.toContain('Chitra');
    expect(request!.model).toBe('primary-model');
    expect(request!.timeoutMs).toBe(8000);
    expect(request!.jsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('settles names into resolutions: ambiguous, unknown, and values kept', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Rahul Sharma', 'Rahul Kumar', 'Priya']);
    primaryAnswer = () => ({
      output: extraction({
        amount: '1000',
        payer: { kind: 'person', name: 'Priya' },
        people: [
          { name: 'Rahul', isMe: false },
          { name: 'Amit', isMe: false },
          { name: 'me', isMe: true },
        ],
        split: {
          method: 'exact',
          values: [
            { name: 'Rahul', value: '500' },
            { name: 'Amit', value: '200' },
            { name: 'me', value: '300' },
          ],
        },
      }),
    });

    const result = await parsed(asha, 'Priya paid 1000: Rahul 500, Amit 200, mine 300', goa.id);

    expect(result.draft.payerId).toBe(idOf(goa, 'Priya'));
    expect(result.draft.split).toEqual({
      method: 'exact',
      amounts: [{ userId: asha.id, amount: 30_000 }],
    });
    expect(result.resolutions).toEqual([
      { name: 'Priya', role: 'payer', value: null, status: 'resolved', userId: idOf(goa, 'Priya') },
      {
        name: 'Rahul',
        role: 'participant',
        value: '500',
        status: 'ambiguous',
        candidates: [
          goa.members.find((m) => m.user.name === 'Rahul Sharma')!.user,
          goa.members.find((m) => m.user.name === 'Rahul Kumar')!.user,
        ],
      },
      { name: 'Amit', role: 'participant', value: '200', status: 'unknown' },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('adds up a total from exact amounts when none was written', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    primaryAnswer = () => ({
      output: extraction({
        amount: null,
        people: [
          { name: 'Bilal', isMe: false },
          { name: 'me', isMe: true },
        ],
        split: {
          method: 'exact',
          values: [
            { name: 'Bilal', value: '600' },
            { name: 'me', value: '400' },
          ],
        },
      }),
    });

    const result = await parsed(asha, 'bilal ka 600 mera 400', goa.id);

    expect(result.draft.amount).toBe(100_000);
    expect(result.issues).toEqual([]);
  });

  it('can be saved as an expense linked to its request (source ai_text)', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    primaryAnswer = () => ({ output: extraction({ includesEveryone: true }) });
    const result = await parsed(asha, 'dinner ka 2400 maine diya, sab mein barabar', goa.id);

    const id = uuidv7();
    const saved = await ctx.call(asha, 'POST', `/api/v1/groups/${goa.id}/expenses`, {
      id,
      description: result.draft.description,
      amount: result.draft.amount,
      currency: 'INR',
      occurredOn: TODAY,
      payers: [{ userId: result.draft.payerId, amount: result.draft.amount }],
      split: result.draft.split,
      aiRequestId: result.requestId,
    });

    expect(saved.status).toBe(201);
    const [row] = await ctx.db.select().from(transactions).where(eq(transactions.id, id));
    expect(row).toMatchObject({ source: 'ai_text', aiRequestId: result.requestId });
  });
});

describe('failures fall back, never a dead end (Blueprint 8.8)', () => {
  it('tries the fallback provider when the primary’s output is invalid', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    primaryAnswer = () => ({ output: { amount: 2400 } });
    fallbackAnswer = () => ({ output: extraction() });

    const result = await parsed(asha, 'kal ka khana 2400', goa.id);

    const rows = await rowsFor(asha.id);
    expect(rows.map((r) => [r.provider, r.model, r.outcome])).toEqual([
      ['groq', 'primary-model', 'invalid_output'],
      ['cloudflare', 'fallback-model', 'ok'],
    ]);
    expect(result).toMatchObject({ path: 'llm', requestId: rows[1]!.id });
  });

  it.each(['timeout', 'rate_limited', 'error'] as const)(
    'falls back to the form after a %s from every provider',
    async (fail) => {
      const asha = await person('asha');
      const goa = await groupWith(asha, ['Bilal']);
      primaryAnswer = () => ({ fail });
      fallbackAnswer = () => ({ fail: 'invalid_output' });

      const result = await parsed(asha, 'kal ka khana 2400 sabke liye', goa.id);

      const rows = await rowsFor(asha.id);
      expect(rows.map((r) => r.outcome)).toEqual([fail, 'invalid_output']);
      expect(result).toMatchObject({
        path: 'fallback',
        requestId: rows[1]!.id,
        // What the rules found, and the sentence as typed for the person to finish.
        draft: { amount: 240_000, description: 'kal ka khana 2400 sabke liye' },
      });
    },
  );

  it('falls back without a call when the kill switch is off', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    config.enabled = false;

    const result = await parsed(asha, 'kal ka khana 2400', goa.id);

    expect(result).toMatchObject({ path: 'fallback', requestId: null });
    expect(primary.requests).toHaveLength(0);
    expect(await rowsFor(asha.id)).toHaveLength(0);
  });

  it('stops calling providers once the day’s budget is spent', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    config.providers[0]!.price = { input: 1, output: 5 }; // 500 + 100 tokens → 1,000 micros
    // Whatever the shared database spent today counts too: the budget is global.
    const spent = await ctx.db.select({ cost: aiRequests.costMicros }).from(aiRequests);
    config.dailyBudgetMicros = spent.reduce((sum, r) => sum + (r.cost ?? 0), 0) + 1000;
    primaryAnswer = () => ({ output: extraction() });

    expect((await parsed(asha, 'kal ka khana 2400', goa.id)).path).toBe('llm');
    expect((await rowsFor(asha.id))[0]!.costMicros).toBe(1000);
    expect((await parsed(asha, 'kal ka khana 2400', goa.id)).path).toBe('fallback');
    expect(primary.requests).toHaveLength(1);
  });

  it('skips a provider past its daily token cap, using the next one', async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    const today = await ctx.db.select().from(aiRequests).where(eq(aiRequests.provider, 'groq'));
    const used = today.reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
    config.providers[0]!.dailyTokens = used + 600; // room for exactly one more 600-token call
    primaryAnswer = () => ({ output: extraction() });
    fallbackAnswer = () => ({ output: extraction() });

    await parsed(asha, 'kal ka khana 2400', goa.id);
    await parsed(asha, 'kal ka khana 2400', goa.id);

    expect((await rowsFor(asha.id)).map((r) => r.provider)).toEqual(['groq', 'cloudflare']);
  });
});

describe('limits (Blueprint 8.9)', () => {
  it('answers 429 AI_RATE_LIMITED past the per-minute limit, but rules still read', async () => {
    const limited = await integrationApp({
      ai: { ...config, providers: [{ provider: primary, textModel: 'primary-model' }] },
      aiLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }),
    });
    try {
      const asha = await limited.person(`asha+${++n}@example.com`);
      const goa = Group.parse(
        (
          await limited.call(asha, 'POST', '/api/v1/groups', {
            id: uuidv7(),
            name: 'Goa',
            currency: 'INR',
            members: [{ name: 'Bilal' }],
          })
        ).body,
      );
      primaryAnswer = () => ({ output: extraction() });
      const send = (text: string) =>
        limited.request('/api/v1/ai/parse-expense', {
          method: 'POST',
          cookie: asha.cookie,
          body: { text, groupId: goa.id, today: TODAY },
        });

      expect((await send('kal ka khana 2400')).status).toBe(200);
      const refused = await send('kal ka khana 2400');
      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toMatch(/^\d+$/);
      expect(code(await refused.json())).toBe('AI_RATE_LIMITED');
      expect((await send('I paid 300 for cab with Bilal')).status).toBe(200);
    } finally {
      await limited.drop();
    }
  });

  it(`answers 429 after ${AI_CALLS_PER_USER_PER_DAY} calls in a day`, async () => {
    const asha = await person('asha');
    const goa = await groupWith(asha, ['Bilal']);
    await ctx.db.insert(aiRequests).values(
      Array.from({ length: AI_CALLS_PER_USER_PER_DAY }, () => ({
        userId: asha.id,
        kind: 'parse_expense',
        path: 'llm' as const,
        outcome: 'ok' as const,
      })),
    );

    const res = await parse(asha, 'kal ka khana 2400', goa.id);

    expect(res.status).toBe(429);
    expect(code(res.body)).toBe('AI_RATE_LIMITED');
  });
});

describe('the group', () => {
  it('is chosen from the names when none is given (Blueprint 8.6)', async () => {
    const asha = await person('asha');
    await groupWith(asha, ['Bilal'], 'Flat');
    const goa = await groupWith(asha, ['Chitra', 'Dev'], 'Goa');
    primaryAnswer = () => ({
      output: extraction({
        people: [
          { name: 'Chitra', isMe: false },
          { name: 'me', isMe: true },
        ],
      }),
    });

    const result = await parsed(asha, 'Chitra ke saath lunch 900');

    expect(result.groupId).toBe(goa.id);
    expect(result.draft.split).toEqual({
      method: 'equal',
      participants: [idOf(goa, 'Chitra'), asha.id],
    });
  });

  it('is null when the person has no groups yet', async () => {
    const asha = await person('asha');
    expect(await parsed(asha, 'lunch 900')).toMatchObject({ groupId: null, path: 'fallback' });
  });

  it('must be one the person is in', async () => {
    const asha = await person('asha');
    const other = await person('other');
    const theirs = await groupWith(other, ['Bilal']);
    const res = await parse(asha, 'lunch 900', theirs.id);
    expect(res.status).toBe(404);
    expect(code(res.body)).toBe('NOT_FOUND');
  });
});
