import { describe, expect, it } from 'vitest';
import { MAX_PEOPLE_PER_TRANSACTION, SplitInput } from './split';
import { expectValid, ids, rejectedPaths, uuid } from './testing/fixtures';

const many = (n: number) => Array.from({ length: n }, (_, i) => uuid(`e${i}`));

describe('SplitInput', () => {
  it.each([
    { method: 'equal', participants: [ids.a, ids.b] },
    {
      method: 'exact',
      amounts: [
        { userId: ids.a, amount: 100 },
        { userId: ids.b, amount: 0 },
      ],
    },
    {
      method: 'percent',
      basisPoints: [
        { userId: ids.a, bp: 3334 },
        { userId: ids.b, bp: 6666 },
      ],
    },
    {
      method: 'shares',
      shares: [
        { userId: ids.a, shares: 3 },
        { userId: ids.b, shares: 0 },
      ],
    },
  ])('accepts a $method split', (split) => expect(expectValid(SplitInput, split)).toEqual(split));

  it('allows up to 50 people', () => {
    expectValid(SplitInput, { method: 'equal', participants: many(MAX_PEOPLE_PER_TRANSACTION) });
    expect(rejectedPaths(SplitInput, { method: 'equal', participants: many(51) })).toEqual([
      'participants',
    ]);
  });

  it.each([
    [{ method: 'equal', participants: [] }, 'participants'],
    [{ method: 'equal', participants: ['Asha'] }, 'participants.0'],
    [{ method: 'exact', amounts: [{ userId: ids.a, amount: -1 }] }, 'amounts.0.amount'],
    [{ method: 'exact', amounts: [{ userId: ids.a, amount: 1.5 }] }, 'amounts.0.amount'],
    [{ method: 'exact', amounts: [{ userId: ids.a, amount: 10_000_000_001 }] }, 'amounts.0.amount'],
    [{ method: 'percent', basisPoints: [{ userId: ids.a, bp: 10_001 }] }, 'basisPoints.0.bp'],
    [{ method: 'percent', basisPoints: [{ userId: ids.a, bp: 33.33 }] }, 'basisPoints.0.bp'],
    [{ method: 'shares', shares: [{ userId: ids.a, shares: 1001 }] }, 'shares.0.shares'],
    [{ method: 'shares', shares: [{ userId: ids.a, shares: 0.5 }] }, 'shares.0.shares'],
    [{ method: 'equal', participants: [ids.a], amounts: [] }, ''],
    [{ method: 'equal', amounts: [{ userId: ids.a, amount: 1 }] }, 'participants'],
    [{ method: 'itemized', items: [] }, 'method'],
  ])('rejects %j at %j', (split, path) => expect(rejectedPaths(SplitInput, split)).toContain(path));

  it('leaves sums and duplicates to core', () => {
    // These are rule violations, not shape errors: core reports them with a specific code.
    expectValid(SplitInput, { method: 'percent', basisPoints: [{ userId: ids.a, bp: 5000 }] });
    expectValid(SplitInput, { method: 'equal', participants: [ids.a, ids.a] });
    expectValid(SplitInput, { method: 'shares', shares: [{ userId: ids.a, shares: 0 }] });
  });
});
