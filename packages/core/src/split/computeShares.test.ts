import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import { computeShares, type SplitInput } from './computeShares';

const code = (c: string) => expect.objectContaining({ code: c }) as Error;

describe('computeShares: equal', () => {
  it('splits among a subset of the group', () => {
    expect(
      computeShares(120_000, { method: 'equal', participants: ['c', 'a', 'b'] }, 'tx'),
    ).toEqual([
      { userId: 'a', amount: 40_000 },
      { userId: 'b', amount: 40_000 },
      { userId: 'c', amount: 40_000 },
    ]);
  });

  it('rounds to the paisa and still sums to the total', () => {
    const lines = computeShares(10_000, { method: 'equal', participants: ['a', 'b', 'c'] }, 'tx');
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(10_000);
  });

  it('omits people whose share rounds to zero', () => {
    const lines = computeShares(1, { method: 'equal', participants: ['a', 'b', 'c'] }, 'tx');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount).toBe(1);
  });

  it('needs at least one participant', () => {
    expect(() => computeShares(100, { method: 'equal', participants: [] }, 'tx')).toThrow(
      code('NO_PARTICIPANTS'),
    );
  });

  it('rejects the same participant twice', () => {
    expect(() => computeShares(100, { method: 'equal', participants: ['a', 'a'] }, 'tx')).toThrow(
      code('DUPLICATE_USER'),
    );
  });
});

describe('computeShares: exact', () => {
  it('uses the amounts as given, sorted, without zero rows', () => {
    const split: SplitInput = {
      method: 'exact',
      amounts: [
        { userId: 'b', amount: 140_000 },
        { userId: 'c', amount: 0 },
        { userId: 'a', amount: 100_000 },
      ],
    };
    expect(computeShares(240_000, split, 'tx')).toEqual([
      { userId: 'a', amount: 100_000 },
      { userId: 'b', amount: 140_000 },
    ]);
  });

  it('reports SPLIT_SUM_MISMATCH with the expected and actual sums', () => {
    const split: SplitInput = {
      method: 'exact',
      amounts: [
        { userId: 'a', amount: 100_000 },
        { userId: 'b', amount: 130_000 },
      ],
    };
    expect(() => computeShares(240_000, split, 'tx')).toThrow(
      expect.objectContaining({
        code: 'SPLIT_SUM_MISMATCH',
        details: { expected: 240_000, actual: 230_000 },
      }) as Error,
    );
  });

  it.each([-1, 1.5, 20_000_000_000])('rejects an individual amount of %d', (amount) => {
    const split: SplitInput = { method: 'exact', amounts: [{ userId: 'a', amount }] };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('AMOUNT_OUT_OF_RANGE'));
  });

  it('rejects the same person twice', () => {
    const split: SplitInput = {
      method: 'exact',
      amounts: [
        { userId: 'a', amount: 50 },
        { userId: 'a', amount: 50 },
      ],
    };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('DUPLICATE_USER'));
  });
});

describe('computeShares: percent', () => {
  it('splits 33.33 / 33.33 / 33.34 exactly', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { userId: 'a', bp: 3_333 },
        { userId: 'b', bp: 3_333 },
        { userId: 'c', bp: 3_334 },
      ],
    };
    expect(computeShares(10_000, split, 'tx').map((l) => l.amount)).toEqual([3_333, 3_333, 3_334]);
  });

  it('splits a ₹500 cab 50/30/20 as ₹250/₹150/₹100', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { userId: 'a', bp: 5_000 },
        { userId: 'b', bp: 3_000 },
        { userId: 'c', bp: 2_000 },
      ],
    };
    expect(computeShares(50_000, split, 'tx').map((l) => l.amount)).toEqual([
      25_000, 15_000, 10_000,
    ]);
  });

  it('excludes people at 0%', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { userId: 'a', bp: 10_000 },
        { userId: 'b', bp: 0 },
      ],
    };
    expect(computeShares(999, split, 'tx')).toEqual([{ userId: 'a', amount: 999 }]);
  });

  it('reports PERCENT_SUM_INVALID when percentages do not add up to 100', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { userId: 'a', bp: 5_000 },
        { userId: 'b', bp: 4_999 },
      ],
    };
    expect(() => computeShares(100, split, 'tx')).toThrow(
      expect.objectContaining({
        code: 'PERCENT_SUM_INVALID',
        details: { expected: 10_000, actual: 9_999 },
      }) as Error,
    );
  });

  it.each([-1, 10_001, 33.5])('rejects a basis-point value of %d', (bp) => {
    const split: SplitInput = { method: 'percent', basisPoints: [{ userId: 'a', bp }] };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('INVALID_PERCENT'));
  });

  it('rejects the same person twice', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { userId: 'a', bp: 5_000 },
        { userId: 'a', bp: 5_000 },
      ],
    };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('DUPLICATE_USER'));
  });
});

describe('computeShares: shares', () => {
  it('splits 2:1:1', () => {
    const split: SplitInput = {
      method: 'shares',
      shares: [
        { userId: 'couple', shares: 2 },
        { userId: 'x', shares: 1 },
        { userId: 'y', shares: 1 },
      ],
    };
    expect(computeShares(100_000, split, 'tx')).toEqual([
      { userId: 'couple', amount: 50_000 },
      { userId: 'x', amount: 25_000 },
      { userId: 'y', amount: 25_000 },
    ]);
  });

  it('excludes people with zero shares', () => {
    const split: SplitInput = {
      method: 'shares',
      shares: [
        { userId: 'a', shares: 3 },
        { userId: 'b', shares: 0 },
      ],
    };
    expect(computeShares(300, split, 'tx')).toEqual([{ userId: 'a', amount: 300 }]);
  });

  it('needs at least one positive share', () => {
    const split: SplitInput = { method: 'shares', shares: [{ userId: 'a', shares: 0 }] };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('NO_PARTICIPANTS'));
  });

  it.each([-1, 1.5, 1_001])('rejects a share count of %d', (shares) => {
    const split: SplitInput = { method: 'shares', shares: [{ userId: 'a', shares }] };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('INVALID_WEIGHT'));
  });

  it('rejects the same person twice', () => {
    const split: SplitInput = {
      method: 'shares',
      shares: [
        { userId: 'a', shares: 1 },
        { userId: 'a', shares: 1 },
      ],
    };
    expect(() => computeShares(100, split, 'tx')).toThrow(code('DUPLICATE_USER'));
  });
});

describe('computeShares: total and method', () => {
  it.each([0, -100, 1.5])('rejects a total of %d', (total) => {
    expect(() => computeShares(total, { method: 'equal', participants: ['a'] }, 'tx')).toThrow(
      code('AMOUNT_OUT_OF_RANGE'),
    );
  });

  it('treats an unknown method as a bug', () => {
    const split = { method: 'adjustment', participants: ['a'] } as unknown as SplitInput;
    expect(() => computeShares(100, split, 'tx')).toThrow(InvariantViolation);
  });

  it('gives 100% to one person when they are the only participant', () => {
    const split: SplitInput = { method: 'percent', basisPoints: [{ userId: 'a', bp: 10_000 }] };
    expect(computeShares(12_345, split, 'tx')).toEqual([{ userId: 'a', amount: 12_345 }]);
  });
});
