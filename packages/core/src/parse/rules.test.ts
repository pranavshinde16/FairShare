import { describe, expect, it } from 'vitest';
import { parseRules, type RuleParse, type RuleParseInput } from './rules';

const TODAY = '2026-11-13';
const KNOWN = ['Pranav Shinde', 'Rahul Sharma', 'Amit', 'Chitra', 'Priya Iyer'];
const parse = (text: string, extra: Partial<RuleParseInput> = {}) =>
  parseRules({ text, today: TODAY, currency: 'INR', minorUnits: 2, knownNames: KNOWN, ...extra });

const me = { kind: 'me' } as const;
const person = (name: string) => ({ kind: 'person', name }) as const;
const high = (patch: Partial<RuleParse>): RuleParse => ({
  amount: null,
  description: null,
  date: null,
  payer: me,
  people: [],
  everyone: true,
  confidence: 'high',
  doubts: [],
  ...patch,
});

// Blueprint 10.2 "Rule parser: about 60 table-driven cases, covering both high- and
// low-confidence decisions."
describe('parseRules: high confidence', () => {
  it.each<[string, Partial<RuleParse>]>([
    // amounts
    ['2400 dinner', { amount: 240_000, description: 'Dinner' }],
    ['₹2,400 dinner', { amount: 240_000, description: 'Dinner' }],
    ['rs 2400 groceries', { amount: 240_000, description: 'Groceries' }],
    ['Rs. 2400 groceries', { amount: 240_000, description: 'Groceries' }],
    ['groceries 2400rs', { amount: 240_000, description: 'Groceries' }],
    ['INR 2400 taxi', { amount: 240_000, description: 'Taxi' }],
    ['2400 rupees taxi', { amount: 240_000, description: 'Taxi' }],
    ['2.4k hotel', { amount: 240_000, description: 'Hotel' }],
    ['hotel 12K', { amount: 1_200_000, description: 'Hotel' }],
    ['1.23456k parts', { amount: 123_456, description: 'Parts' }],
    ['tea 12.50', { amount: 1250, description: 'Tea' }],
    ['tea .5', { amount: 50, description: 'Tea' }],
    ['2,00,000 rent', { amount: 20_000_000, description: 'Rent' }],
    ['2400', { amount: 240_000, description: null }],
    // people
    [
      'dinner 2400 with Rahul and Amit',
      { amount: 240_000, description: 'Dinner', people: ['Rahul', 'Amit'], everyone: false },
    ],
    [
      'Dinner 2400 with Rahul & Amit',
      { amount: 240_000, description: 'Dinner', people: ['Rahul', 'Amit'], everyone: false },
    ],
    [
      'dinner 2400 with Rahul, Amit and Chitra',
      {
        amount: 240_000,
        description: 'Dinner',
        people: ['Rahul', 'Amit', 'Chitra'],
        everyone: false,
      },
    ],
    [
      'dinner 2400 with Rahul Sharma and Amit',
      { amount: 240_000, description: 'Dinner', people: ['Rahul Sharma', 'Amit'], everyone: false },
    ],
    [
      'lunch 600 between me and Priya',
      { amount: 60_000, description: 'Lunch', people: ['Priya'], everyone: false },
    ],
    [
      'dinner 2400 split equally among Rahul + Amit',
      { amount: 240_000, description: 'Dinner', people: ['Rahul', 'Amit'], everyone: false },
    ],
    ['dinner 2400 with everyone', { amount: 240_000, description: 'Dinner' }],
    ['dinner 2400 split with all', { amount: 240_000, description: 'Dinner' }],
    ['dinner 2400 with the group', { amount: 240_000, description: 'Dinner' }],
    [
      '2400 dinner pranav rahul',
      { amount: 240_000, description: 'Dinner', people: ['pranav', 'rahul'], everyone: false },
    ],
    [
      '2400 dinner me amit',
      { amount: 240_000, description: 'Dinner', people: ['amit'], everyone: false },
    ],
    [
      'dinner with Rahul pizza 900',
      { amount: 90_000, description: 'Dinner pizza', people: ['Rahul'], everyone: false },
    ],
    [
      'dinner 900 with Rahul and Rahul',
      { amount: 90_000, description: 'Dinner', people: ['Rahul'], everyone: false },
    ],
    // payers
    [
      'I paid 2400 for dinner with Rahul and Amit',
      { amount: 240_000, description: 'Dinner', people: ['Rahul', 'Amit'], everyone: false },
    ],
    ['taxi 500 paid by me', { amount: 50_000, description: 'Taxi' }],
    ['taxi 500 paid', { amount: 50_000, description: 'Taxi' }],
    [
      'I spent 300 on coffee with Amit',
      { amount: 30_000, description: 'Coffee', people: ['Amit'], everyone: false },
    ],
    [
      'Rahul paid 1500 for petrol',
      { amount: 150_000, description: 'Petrol', payer: person('Rahul') },
    ],
    [
      'Rahul Sharma paid 1500 for petrol',
      { amount: 150_000, description: 'Petrol', payer: person('Rahul Sharma') },
    ],
    [
      'paid by Amit 800 for snacks',
      { amount: 80_000, description: 'Snacks', payer: person('Amit') },
    ],
    [
      'petrol 1500 paid by Rahul Sharma',
      { amount: 150_000, description: 'Petrol', payer: person('Rahul Sharma') },
    ],
    ['Dinner Rahul paid 900', { amount: 90_000, description: 'Dinner', payer: person('Rahul') }],
    ['paid by Zara 700 for cake', { amount: 70_000, description: 'Cake', payer: person('Zara') }],
    // dates
    ['taxi 500 yesterday', { amount: 50_000, description: 'Taxi', date: '2026-11-12' }],
    ['Today lunch 450', { amount: 45_000, description: 'Lunch', date: TODAY }],
    ['taxi 500 today today', { amount: 50_000, description: 'Taxi', date: TODAY }],
    // descriptions
    ["Domino's pizza 600", { amount: 60_000, description: "Domino's pizza" }],
    ['600 for the A/C repair', { amount: 60_000, description: 'A/C repair' }],
    ['dinner at Thalassa 3200', { amount: 320_000, description: 'Dinner at Thalassa' }],
    ['main course 500', { amount: 50_000, description: 'Main course' }],
  ])('%j', (text, expected) => {
    expect(parse(text)).toEqual(high(expected));
  });

  it('reads money in the currency’s own decimals', () => {
    expect(parse('ramen 1.5k', { currency: 'JPY', minorUnits: 0 })).toMatchObject({
      amount: 1500,
      confidence: 'high',
    });
    expect(parse('$12.50 taxi', { currency: 'USD' })).toMatchObject({
      amount: 1250,
      confidence: 'high',
    });
    expect(parse('€8 coffee', { currency: 'EUR' }).amount).toBe(800);
    expect(parse('£8 tea', { currency: 'GBP' }).amount).toBe(800);
  });

  it('without known names, bare words stay in the description', () => {
    expect(parse('2400 dinner pranav rahul', { knownNames: undefined })).toEqual(
      high({ amount: 240_000, description: 'Dinner pranav rahul' }),
    );
    // And a payer is one word.
    expect(parse('Rahul Sharma paid 500', { knownNames: undefined }).payer).toEqual(
      person('Sharma'),
    );
  });
});

describe('parseRules: low confidence', () => {
  it.each<[string, string[]]>([
    // amounts
    ['dinner with Rahul', ['NO_AMOUNT']],
    ['dinner 2400 1200', ['SEVERAL_AMOUNTS']],
    ['dinner for 3 people 2400', ['SEVERAL_AMOUNTS']],
    ['tea 12.345', ['AMOUNT_INVALID']],
    ['tea 0', ['AMOUNT_INVALID']],
    ['tea 1,2,3', ['AMOUNT_INVALID']],
    ['1.234567k parts', ['AMOUNT_INVALID']],
    ['yacht 100000001', ['AMOUNT_INVALID']],
    ['$15 taxi', ['CURRENCY_MISMATCH']],
    ['taxi 15 usd', ['CURRENCY_MISMATCH']],
    // other split methods
    ['dinner 2400 only me and Rahul', ['UNSUPPORTED']],
    ['1500 except Amit', ['UNSUPPORTED']],
    ['half of 2400 for dinner', ['UNSUPPORTED']],
    ['500 each for tickets', ['UNSUPPORTED']],
    ['dinner 2400 60% Rahul', ['SEVERAL_AMOUNTS', 'UNSUPPORTED']],
    ['dinner 60% Rahul', ['UNSUPPORTED']],
    ['hotel 3000 2 shares for me', ['SEVERAL_AMOUNTS', 'UNSUPPORTED']],
    // debts and settlements
    ['Rahul owes me 500', ['UNSUPPORTED']],
    ['paid back 500 to Amit', ['UNSUPPORTED']],
    // dates
    ['dinner tomorrow 500', ['UNSUPPORTED']],
    ['taxi 500 today yesterday', ['DATE_UNCLEAR']],
    ['movie last friday 600', ['UNSUPPORTED']],
    // Hinglish (Blueprint 8: these go to the LLM)
    ['dinner ka 2400 maine diya, sab mein barabar', ['UNSUPPORTED']],
    ['Rahul ne petrol ke 1500 diye, sirf hum dono', ['UNSUPPORTED']],
    // payers
    ['Rahul and Amit paid 900 for dinner', ['PAYER_UNCLEAR', 'SPLIT_UNCLEAR']],
    ['Rahul, Amit paid 900', ['PAYER_UNCLEAR', 'SPLIT_UNCLEAR']],
    // "taxi paid" or an unknown name before "paid": asked, not guessed
    ['500 taxi paid', ['PAYER_UNCLEAR']],
    ['Zara paid 700 for cake', ['PAYER_UNCLEAR']],
    ['Rahul paid 500 and Amit paid 400', ['PAYER_UNCLEAR', 'SEVERAL_AMOUNTS']],
    ['taxi 500 paid by', ['PAYER_UNCLEAR']],
    ['Rahul paid 500 for dinner with Amit', ['SPLIT_UNCLEAR']],
  ])('%j', (text, doubts) => {
    const result = parse(text);
    expect(result.confidence).toBe('low');
    expect(result.doubts).toEqual([...doubts].sort());
  });

  it('keeps what it did understand', () => {
    expect(parse('dinner 2400 only me and Rahul')).toMatchObject({
      amount: 240_000,
      description: 'Dinner only',
      people: ['Rahul'],
    });
    // An amount in another currency is not used as this group's amount.
    expect(parse('$15 taxi')).toMatchObject({ amount: null, description: 'Taxi' });
  });
});

describe('parseRules: edges', () => {
  it('leaves a lone "with" in the description', () => {
    expect(parse('coffee with 300')).toEqual(high({ amount: 30_000, description: 'Coffee with' }));
  });

  it('leaves a trailing "and" out of the list', () => {
    expect(parse('dinner 500 with Rahul and')).toEqual(
      high({ amount: 50_000, description: 'Dinner', people: ['Rahul'], everyone: false }),
    );
  });

  it('caps a description at 120 characters', () => {
    const long = `500 ${'very '.repeat(40)}long`;
    const description = parse(long).description!;
    expect(description.length).toBeLessThanOrEqual(120);
    expect(description.startsWith('Very very')).toBe(true);
  });

  it('crosses a month and a year for "yesterday"', () => {
    expect(parse('taxi 50 yesterday', { today: '2026-03-01' }).date).toBe('2026-02-28');
    expect(parse('taxi 50 yesterday', { today: '2028-03-01' }).date).toBe('2028-02-29');
    expect(parse('taxi 50 yesterday', { today: '2027-01-01' }).date).toBe('2026-12-31');
  });

  it('refuses an unknown currency precision', () => {
    expect(() => parse('tea 5', { minorUnits: 7 })).toThrow();
  });

  it('ignores punctuation it has no use for', () => {
    expect(parse('!! dinner, 2400 ...')).toEqual(high({ amount: 240_000, description: 'Dinner' }));
  });
});
