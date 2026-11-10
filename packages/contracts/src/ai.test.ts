import { describe, expect, it } from 'vitest';
import {
  ExpenseDraft,
  LlmExpenseExtraction,
  llmExpenseExtractionJsonSchema,
  ParseExpenseRequest,
  ParseResult,
} from './ai';
import { expectValid, ids, rejectedPaths, userRef, withField } from './testing/fixtures';

/** "Dinner 2,400 with Rahul and Amit, I paid" */
const extraction = {
  amount: '2,400',
  currency: null,
  description: 'Dinner',
  date: null,
  payer: { kind: 'me', name: null },
  people: [
    { name: 'Rahul', isMe: false },
    { name: 'Amit', isMe: false },
    { name: 'me', isMe: true },
  ],
  includesEveryone: false,
  split: { method: 'equal', values: null },
  category: 'Food',
  notes: null,
};

describe('LlmExpenseExtraction', () => {
  it('accepts a typical extraction', () =>
    expect(expectValid(LlmExpenseExtraction, extraction)).toEqual(extraction));

  it('keeps numbers as strings for core to parse', () => {
    expect(LlmExpenseExtraction.safeParse({ ...extraction, amount: 2400 }).success).toBe(false);
    expectValid(LlmExpenseExtraction, {
      ...extraction,
      split: {
        method: 'percent',
        values: [
          { name: 'Rahul', value: '60%' },
          { name: 'Amit', value: '40' },
        ],
      },
    });
  });

  it('is strict: extra keys mean the output is invalid and the server falls back', () => {
    expect(rejectedPaths(LlmExpenseExtraction, { ...extraction, confidence: 0.9 })).toEqual(['']);
    expect(
      rejectedPaths(LlmExpenseExtraction, {
        ...extraction,
        payer: { kind: 'me', name: null, x: 1 },
      }),
    ).toEqual(['payer']);
  });

  it('requires every field, so the model always answers each one (null when absent)', () => {
    for (const key of Object.keys(extraction)) {
      const output: Record<string, unknown> = { ...extraction };
      delete output[key];
      expect(rejectedPaths(LlmExpenseExtraction, output)).toEqual([key]);
    }
  });

  it.each([
    [{ currency: 'RS' }, 'currency'],
    [{ currency: 'RUPEES' }, 'currency'],
    [{ payer: { kind: 'someone', name: null } }, 'payer.kind'],
    [{ split: { method: 'half', values: null } }, 'split.method'],
    [{ description: 'x'.repeat(121) }, 'description'],
    [{ people: Array.from({ length: 51 }, () => ({ name: 'P', isMe: false })) }, 'people'],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(LlmExpenseExtraction, withField(extraction, patch))).toEqual([path]),
  );
});

describe('llmExpenseExtractionJsonSchema', () => {
  const schema = llmExpenseExtractionJsonSchema();

  it('matches the reviewed snapshot (a change here changes what the model is asked for)', async () => {
    await expect(JSON.stringify(schema, null, 2) + '\n').toMatchFileSnapshot(
      '../schemas/llm-expense-extraction.schema.json',
    );
  });

  it('is closed and fully required at every level, as structured-output modes expect', () => {
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      if (
        record.type === 'object' ||
        (Array.isArray(record.type) && record.type.includes('object'))
      ) {
        objects.push(record);
      }
      Object.values(record).forEach(walk);
    };
    walk(schema);

    expect(objects).toHaveLength(5); // root, payer, people[], split, split.values[]
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(new Set(object.required as string[])).toEqual(
        new Set(Object.keys(object.properties as object)),
      );
    }
  });

  it('carries the field descriptions to the model', () => {
    const properties = schema.properties as Record<string, { description?: string }>;
    expect(properties.amount?.description).toMatch(/exactly as written/);
    expect(
      Object.values(properties).every(
        (p) => typeof p.description === 'string' || p === properties.split,
      ),
    ).toBe(true);
  });
});

describe('ParseExpenseRequest', () => {
  it('accepts text with or without a group', () => {
    expectValid(ParseExpenseRequest, { text: 'dinner 2400 with rahul', today: '2026-11-07' });
    expectValid(ParseExpenseRequest, { text: 'cab 450', groupId: ids.group, today: '2026-11-07' });
  });

  it.each([
    [{ text: ' hi ' }, 'text'],
    [{ text: 'x'.repeat(501) }, 'text'],
    [{ today: '07-11-2026' }, 'today'],
    [{ groupId: 'goa' }, 'groupId'],
    [{ model: 'big' }, ''],
  ])('rejects %j', (patch, path) =>
    expect(
      rejectedPaths(ParseExpenseRequest, { text: 'dinner 2400', today: '2026-11-07', ...patch }),
    ).toEqual([path]),
  );
});

describe('ParseResult', () => {
  const result = {
    requestId: 12,
    path: 'llm',
    groupId: ids.group,
    draft: { description: 'Dinner', amount: 240_000, currency: 'INR' },
    resolutions: [
      {
        name: 'Rahul',
        status: 'ambiguous',
        candidates: [userRef(ids.b, 'Rahul S'), userRef(ids.c, 'Rahul K')],
      },
      { name: 'Amit', status: 'unknown' },
      { name: 'Dev', status: 'resolved', userId: ids.d },
    ],
    issues: [{ code: 'PERCENT_SUM_INVALID', message: 'Percentages add up to 90%.' }],
  };

  it('accepts a draft with resolutions and issues', () => expectValid(ParseResult, result));

  it('accepts the rule-based path with no request row and an empty draft', () => {
    expectValid(ParseResult, {
      ...result,
      requestId: null,
      path: 'rules',
      draft: {},
      resolutions: [],
      issues: [],
    });
  });

  it.each([
    [{ path: 'magic' }, 'path'],
    [{ requestId: 0 }, 'requestId'],
    [{ draft: { amount: 0 } }, 'draft.amount'],
    [
      {
        resolutions: [
          { name: 'Rahul', status: 'ambiguous', candidates: [userRef(ids.b, 'Rahul')] },
        ],
      },
      'resolutions.0.candidates',
    ],
    [{ resolutions: [{ name: 'Dev', status: 'resolved' }] }, 'resolutions.0.userId'],
    [{ issues: [{ code: 'CONFUSED', message: '?' }] }, 'issues.0.code'],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(ParseResult, withField(result, patch))).toEqual([path]),
  );

  it('has a draft in the form’s own shape, every field optional', () => {
    expectValid(ExpenseDraft, { split: { method: 'equal', participants: [ids.a] } });
    expect(ExpenseDraft.safeParse({ total: 5 }).success).toBe(false);
  });
});
