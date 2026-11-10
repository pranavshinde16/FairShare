import { describe, expect, it } from 'vitest';
import { DomainError, InvariantViolation } from '../errors';
import { MAX_AMOUNT_MINOR } from '../money/constants';
import { allocateProportional, assertUniqueUsers, byUserId } from './allocate';
import { fnv1a32 } from './hash';

const equal = (...ids: string[]) => ids.map((userId) => ({ userId, weight: 1 }));
const amounts = (lines: { amount: number }[]) => lines.map((l) => l.amount);

describe('allocateProportional', () => {
  it('splits ₹100 three ways as 3,334 + 3,333 + 3,333 paise', () => {
    const lines = allocateProportional(10_000, equal('a', 'b', 'c'), 'tx-1');
    expect(amounts(lines).sort()).toEqual([3_333, 3_333, 3_334]);
  });

  it('splits ₹1 three ways as 34/33/33', () => {
    const lines = allocateProportional(100, equal('a', 'b', 'c'), 'tx-1');
    expect(amounts(lines).sort()).toEqual([33, 33, 34]);
  });

  it('gives the extra paisa to the person the seed rotation picks', () => {
    for (const seed of ['tx-1', 'tx-2', 'tx-3', 'tx-4']) {
      const lines = allocateProportional(100, equal('a', 'b', 'c'), seed);
      const start = fnv1a32(seed) % 3;
      expect(lines[start]!.amount).toBe(34);
    }
  });

  it('rotates the extra paisa so nobody always pays it', () => {
    const winners = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const lines = allocateProportional(100, equal('a', 'b', 'c'), `tx-${i}`);
      winners.add(lines.find((l) => l.amount === 34)!.userId);
    }
    expect([...winners].sort()).toEqual(['a', 'b', 'c']);
  });

  it('splits 1 paisa among 3 as 1/0/0, keeping the zero lines', () => {
    const lines = allocateProportional(1, equal('a', 'b', 'c'), 'tx-1');
    expect(lines).toHaveLength(3);
    expect(amounts(lines).sort()).toEqual([0, 0, 1]);
  });

  it('gives a single participant the entire total', () => {
    expect(allocateProportional(12_345, equal('solo'), 'tx')).toEqual([
      { userId: 'solo', amount: 12_345 },
    ]);
  });

  it('allocates a zero total as all zeros', () => {
    expect(amounts(allocateProportional(0, equal('a', 'b'), 'tx'))).toEqual([0, 0]);
  });

  it('gives leftovers to the largest remainders before using the seed', () => {
    // 1001 × 2/4 = 500.5 and 1001 × 1/4 = 250.25: the 0.5 remainder wins the extra unit.
    const weights = [
      { userId: 'a', weight: 2 },
      { userId: 'b', weight: 1 },
      { userId: 'c', weight: 1 },
    ];
    for (const seed of ['x', 'y', 'z']) {
      expect(allocateProportional(1_001, weights, seed)).toEqual([
        { userId: 'a', amount: 501 },
        { userId: 'b', amount: 250 },
        { userId: 'c', amount: 250 },
      ]);
    }
  });

  it('is exact for very large totals with very large weights', () => {
    const weights = [
      { userId: 'a', weight: 999_999_937 },
      { userId: 'b', weight: 1 },
      { userId: 'c', weight: 3 },
    ];
    const lines = allocateProportional(MAX_AMOUNT_MINOR, weights, 'tx');
    expect(amounts(lines).reduce((s, a) => s + a, 0)).toBe(MAX_AMOUNT_MINOR);
    expect(lines.map((l) => l.userId)).toEqual(['a', 'b', 'c']);
    // Exact shares: 9,999,999,959.99…, 10.00…, 30.00…; the largest remainder takes the leftover.
    expect(amounts(lines)).toEqual([9_999_999_960, 10, 30]);
  });

  it('returns the same result for the same seed', () => {
    const run = () => allocateProportional(1_000, equal('a', 'b', 'c', 'd', 'e', 'f', 'g'), 'tx');
    expect(run()).toEqual(run());
  });

  it('does not depend on the order participants are given in', () => {
    const forward = allocateProportional(1_000, equal('a', 'b', 'c', 'd', 'e', 'f', 'g'), 'tx');
    const reversed = allocateProportional(1_000, equal('g', 'f', 'e', 'd', 'c', 'b', 'a'), 'tx');
    expect(reversed).toEqual(forward);
  });

  it('returns lines sorted by userId and drops zero weights', () => {
    const lines = allocateProportional(
      300,
      [
        { userId: 'c', weight: 1 },
        { userId: 'z', weight: 0 },
        { userId: 'a', weight: 2 },
      ],
      'tx',
    );
    expect(lines).toEqual([
      { userId: 'a', amount: 200 },
      { userId: 'c', amount: 100 },
    ]);
  });

  it.each([-1, 1.5, MAX_AMOUNT_MINOR + 1, Number.NaN])('rejects a total of %d', (total) => {
    expect(() => allocateProportional(total, equal('a'), 'tx')).toThrow(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }) as Error,
    );
  });

  it.each([-1, 0.5, Number.NaN])('rejects a weight of %d', (weight) => {
    expect(() => allocateProportional(100, [{ userId: 'a', weight }], 'tx')).toThrow(
      expect.objectContaining({ code: 'INVALID_WEIGHT' }) as Error,
    );
  });

  it('rejects the same person twice', () => {
    expect(() => allocateProportional(100, equal('a', 'a'), 'tx')).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_USER' }) as Error,
    );
  });

  it('rejects an allocation with nobody to allocate to', () => {
    expect(() => allocateProportional(100, [], 'tx')).toThrow(
      expect.objectContaining({ code: 'NO_PARTICIPANTS' }) as Error,
    );
    expect(() => allocateProportional(100, [{ userId: 'a', weight: 0 }], 'tx')).toThrow(
      DomainError,
    );
  });
});

describe('byUserId', () => {
  it('orders by userId and treats equal ids as equal', () => {
    expect(byUserId({ userId: 'a' }, { userId: 'b' })).toBe(-1);
    expect(byUserId({ userId: 'b' }, { userId: 'a' })).toBe(1);
    expect(byUserId({ userId: 'a' }, { userId: 'a' })).toBe(0);
  });
});

describe('assertUniqueUsers', () => {
  it('accepts distinct ids and rejects repeats', () => {
    expect(() => assertUniqueUsers(['a', 'b'])).not.toThrow();
    expect(() => assertUniqueUsers(['a', 'b', 'a'])).toThrow(DomainError);
  });
});

describe('internal consistency', () => {
  it('reports InvariantViolation as a distinct error type', () => {
    expect(new InvariantViolation('x')).toBeInstanceOf(Error);
    expect(new InvariantViolation('x')).not.toBeInstanceOf(DomainError);
  });
});
