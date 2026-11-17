import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  draftFromExtraction,
  extractionFromRules,
  type DraftContext,
  type Extraction,
} from './draft';
import { parseRules } from './rules';

const ME = 'u-me';
const [RAHUL_S, RAHUL_K, PRIYA, DEV] = ['u-rahul-s', 'u-rahul-k', 'u-priya', 'u-dev'];

const goa: DraftContext = {
  meId: ME,
  candidates: [
    { userId: ME, name: 'Asha Kapoor' },
    { userId: PRIYA, name: 'Priya Nair' },
    { userId: DEV, name: 'Dev Arora' },
    { userId: RAHUL_S, name: 'Rahul Sharma' },
  ],
  currency: 'INR',
  minorUnits: 2,
  latestDate: '2027-11-16',
};
const twoRahuls: DraftContext = {
  ...goa,
  candidates: [...goa.candidates, { userId: RAHUL_K, name: 'Rahul Kumar' }],
};

const extraction = (patch: Partial<Extraction> = {}): Extraction => ({
  amount: '2400',
  currency: null,
  description: 'Dinner',
  date: null,
  payer: { kind: 'me', name: null },
  people: [],
  includesEveryone: false,
  split: { method: 'equal', values: null },
  category: null,
  notes: null,
  ...patch,
});

describe('draftFromExtraction', () => {
  it('“dinner ka 2400 maine diya, sab mein barabar”: I paid, everyone shares equally', () => {
    const draft = draftFromExtraction(extraction({ includesEveryone: true }), goa);
    expect(draft).toEqual({
      amount: 240_000,
      description: 'Dinner',
      occurredOn: null,
      payerId: ME,
      splitMethod: 'equal',
      split: { method: 'equal', participants: [ME, PRIYA, DEV, RAHUL_S] },
      resolutions: [],
      issues: [],
    });
  });

  it('“Rahul ne petrol ke 1500 diye, sirf hum dono”: Rahul paid, just the two of us', () => {
    const draft = draftFromExtraction(
      extraction({
        amount: '1500',
        description: 'Petrol',
        payer: { kind: 'person', name: 'Rahul' },
        people: [
          { name: 'hum', isMe: true },
          { name: 'Rahul', isMe: false },
        ],
      }),
      goa,
    );
    expect(draft.payerId).toBe(RAHUL_S);
    expect(draft.split).toEqual({ method: 'equal', participants: [ME, RAHUL_S] });
    expect(draft.resolutions).toEqual([
      { name: 'Rahul', status: 'resolved', userId: RAHUL_S, role: 'payer', value: null },
      { name: 'Rahul', status: 'resolved', userId: RAHUL_S, role: 'participant', value: null },
    ]);
  });

  it('names nobody: everyone shares, as with the rule-based parser', () => {
    expect(draftFromExtraction(extraction(), goa).split).toEqual({
      method: 'equal',
      participants: [ME, PRIYA, DEV, RAHUL_S],
    });
  });

  it('leaves out names it can’t settle, and lists them to answer', () => {
    const draft = draftFromExtraction(
      extraction({
        payer: { kind: 'person', name: 'Rahul' },
        people: [
          { name: 'Rahul', isMe: false },
          { name: 'Amit', isMe: false },
          { name: 'Priya', isMe: false },
        ],
      }),
      twoRahuls,
    );
    expect(draft.payerId).toBeNull();
    expect(draft.split).toEqual({ method: 'equal', participants: [PRIYA] });
    expect(draft.resolutions).toEqual([
      {
        name: 'Rahul',
        status: 'ambiguous',
        candidates: [RAHUL_S, RAHUL_K],
        role: 'payer',
        value: null,
      },
      {
        name: 'Rahul',
        status: 'ambiguous',
        candidates: [RAHUL_S, RAHUL_K],
        role: 'participant',
        value: null,
      },
      { name: 'Amit', status: 'unknown', role: 'participant', value: null },
      { name: 'Priya', status: 'resolved', userId: PRIYA, role: 'participant', value: null },
    ]);
  });

  it('has no split when nobody named could be settled', () => {
    const draft = draftFromExtraction(extraction({ people: [{ name: 'Amit', isMe: false }] }), goa);
    expect(draft.split).toBeNull();
  });

  it('reads an exact split, and flags one that doesn’t add up', () => {
    const exact = (values: { name: string; value: string }[]) =>
      draftFromExtraction(
        extraction({
          amount: '1,000',
          people: [
            { name: 'me', isMe: true },
            { name: 'Priya', isMe: false },
          ],
          split: { method: 'exact', values },
        }),
        goa,
      );
    const ok = exact([
      { name: 'Priya', value: '600' },
      { name: 'me', value: '₹400' },
    ]);
    expect(ok.split).toEqual({
      method: 'exact',
      amounts: [
        { userId: PRIYA, amount: 60_000 },
        { userId: ME, amount: 40_000 },
      ],
    });
    expect(ok.issues).toEqual([]);
    expect(exact([{ name: 'Priya', value: '600' }]).issues.map((i) => i.code)).toEqual([
      'SPLIT_SUM_MISMATCH',
    ]);
  });

  it('reads percentages, and flags ones that don’t make 100%', () => {
    const percent = (a: string, b: string) =>
      draftFromExtraction(
        extraction({
          split: {
            method: 'percent',
            values: [
              { name: 'Dev', value: a },
              { name: 'Asha', value: b },
            ],
          },
        }),
        goa,
      );
    expect(percent('66.67%', '33.33').split).toEqual({
      method: 'percent',
      basisPoints: [
        { userId: DEV, bp: 6667 },
        { userId: ME, bp: 3333 },
      ],
    });
    expect(percent('60', '30').issues.map((i) => i.code)).toEqual(['PERCENT_SUM_INVALID']);
  });

  it('reads shares, and flags a value it can’t use', () => {
    const shares = (dev: string) =>
      draftFromExtraction(
        extraction({
          split: {
            method: 'shares',
            values: [
              { name: 'Dev', value: dev },
              { name: 'me', value: '1' },
            ],
          },
        }),
        goa,
      );
    expect(shares('2').split).toEqual({
      method: 'shares',
      shares: [
        { userId: DEV, shares: 2 },
        { userId: ME, shares: 1 },
      ],
    });
    const bad = shares('two');
    expect(bad.issues.map((i) => i.code)).toEqual(['SPLIT_VALUE_INVALID']);
    expect(bad.split).toEqual({ method: 'shares', shares: [{ userId: ME, shares: 1 }] });
  });

  it('keeps an unsettled person’s value with their name, for when it’s answered', () => {
    const draft = draftFromExtraction(
      extraction({
        amount: '1000',
        split: {
          method: 'exact',
          values: [
            { name: 'Rahul', value: '700' },
            { name: 'me', value: '300' },
          ],
        },
      }),
      twoRahuls,
    );
    expect(draft.resolutions).toEqual([
      {
        name: 'Rahul',
        status: 'ambiguous',
        candidates: [RAHUL_S, RAHUL_K],
        role: 'participant',
        value: '700',
      },
    ]);
    expect(draft.split).toEqual({ method: 'exact', amounts: [{ userId: ME, amount: 30_000 }] });
    expect(draft.splitMethod).toBe('exact');
    expect(draft.issues).toEqual([]);
  });

  it('says how to split even when nobody in the split could be settled', () => {
    const draft = draftFromExtraction(
      extraction({ split: { method: 'percent', values: [{ name: 'Rahul', value: '100' }] } }),
      twoRahuls,
    );
    expect(draft.split).toBeNull();
    expect(draft.splitMethod).toBe('percent');
  });

  it('refuses more shares than a person can have', () => {
    const draft = draftFromExtraction(
      extraction({ split: { method: 'shares', values: [{ name: 'Dev', value: '2000' }] } }),
      goa,
    );
    expect(draft.split).toBeNull();
    expect(draft.issues.map((i) => i.code)).toEqual(['SPLIT_VALUE_INVALID']);
  });

  it.each(['0', '-10', '100.5', '33.333', 'half'])('refuses the percentage %j', (value) => {
    const draft = draftFromExtraction(
      extraction({ split: { method: 'percent', values: [{ name: 'Dev', value }] } }),
      goa,
    );
    expect(draft.issues.map((i) => i.code)).toContain('SPLIT_VALUE_INVALID');
  });

  it('reads a rules result with no amount as missing one', () => {
    const parsed = parseRules({
      text: 'dinner with Dev',
      today: '2026-11-16',
      currency: 'INR',
      minorUnits: 2,
    });
    expect(
      draftFromExtraction(extractionFromRules(parsed, 2), goa).issues.map((i) => i.code),
    ).toEqual(['AMOUNT_MISSING']);
  });

  it('falls back to equal when another method came without values', () => {
    const draft = draftFromExtraction(
      extraction({ split: { method: 'percent', values: null } }),
      goa,
    );
    expect(draft.split?.method).toBe('equal');
    expect(draft.splitMethod).toBe('equal');
    expect(draft.issues.map((i) => i.code)).toEqual(['SPLIT_VALUE_INVALID']);
  });

  it.each([
    [{ amount: null }, 'AMOUNT_MISSING'],
    [{ amount: 'lots' }, 'AMOUNT_INVALID'],
    [{ currency: 'USD' }, 'CURRENCY_MISMATCH'],
    [{ date: '2026-02-30' }, 'DATE_INVALID'],
    [{ date: '2027-02-29' }, 'DATE_INVALID'],
    [{ date: '2026-13-01' }, 'DATE_INVALID'],
    [{ date: '2027-11-17' }, 'DATE_INVALID'],
    [{ date: 'yesterday' }, 'DATE_INVALID'],
    [{ payer: { kind: 'person' as const, name: null } }, 'PAYER_UNKNOWN'],
  ])('flags %j', (patch, code) => {
    const draft = draftFromExtraction(extraction(patch), goa);
    expect(draft.issues.map((i) => i.code)).toEqual([code]);
  });

  it('never uses an amount in another currency, and accepts its own in any case', () => {
    expect(draftFromExtraction(extraction({ currency: 'USD' }), goa).amount).toBeNull();
    expect(draftFromExtraction(extraction({ currency: 'inr' }), goa).amount).toBe(240_000);
  });

  it('keeps a valid date, and tidies the description', () => {
    const draft = draftFromExtraction(
      extraction({ date: '2026-02-28', description: `  Cab   to\\nairport ${'x'.repeat(200)}` }),
      goa,
    );
    expect(draft.occurredOn).toBe('2026-02-28');
    expect(draftFromExtraction(extraction({ date: '2024-02-29' }), goa).occurredOn).toBe(
      '2024-02-29',
    );
    expect(draft.description).toHaveLength(120);
    expect(draft.description!.startsWith('Cab to\\nairport')).toBe(true);
  });

  it('never throws on any extraction', () => {
    const text = fc.string({ maxLength: 12 });
    const extractionArb = fc.record({
      amount: fc.option(text),
      currency: fc.option(fc.string({ minLength: 3, maxLength: 3 })),
      description: fc.option(text),
      date: fc.option(text),
      payer: fc.record({
        kind: fc.constantFrom('me' as const, 'person' as const, 'unknown' as const),
        name: fc.option(text),
      }),
      people: fc.array(fc.record({ name: text, isMe: fc.boolean() }), { maxLength: 4 }),
      includesEveryone: fc.boolean(),
      split: fc.record({
        method: fc.constantFrom(
          'equal' as const,
          'exact' as const,
          'percent' as const,
          'shares' as const,
        ),
        values: fc.option(fc.array(fc.record({ name: text, value: text }), { maxLength: 4 })),
      }),
      category: fc.constant(null),
      notes: fc.constant(null),
    });
    fc.assert(
      fc.property(extractionArb, (x) => {
        const draft = draftFromExtraction(x, twoRahuls);
        expect(draft.amount === null || Number.isSafeInteger(draft.amount)).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('extractionFromRules', () => {
  const read = (text: string) =>
    draftFromExtraction(
      extractionFromRules(
        parseRules({
          text,
          today: '2026-11-16',
          currency: 'INR',
          minorUnits: 2,
          knownNames: goa.candidates.map((c) => c.name),
        }),
        2,
      ),
      goa,
    );

  it('gives what the form gives: me, the payer and the people named', () => {
    expect(read('Priya paid 2400 for dinner with Dev')).toMatchObject({
      amount: 240_000,
      description: 'Dinner',
      payerId: PRIYA,
      split: { method: 'equal', participants: [ME, PRIYA, DEV] },
      issues: [],
    });
  });

  it('splits among everyone when nobody is named', () => {
    expect(read('Taxi 300 yesterday')).toMatchObject({
      amount: 30_000,
      occurredOn: '2026-11-15',
      payerId: ME,
      split: { method: 'equal', participants: [ME, PRIYA, DEV, RAHUL_S] },
    });
  });
});
