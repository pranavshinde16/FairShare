// Property-based tests for the split engine (plan §10.3), 1,000 random cases each.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BASIS_POINTS_TOTAL } from '../money/constants';
import { RUNS, seedArb, splitArb, totalArb, usersArb } from '../testing/arbitraries';
import { allocateProportional } from './allocate';
import { computeShares, type SplitInput } from './computeShares';

const caseArb = fc
  .tuple(usersArb(1, 20), totalArb(), seedArb)
  .chain(([users, total, seed]) =>
    splitArb(total, users).map((split) => ({ users, total, seed, split })),
  );

/** The same split with every list in a different order. */
const shuffledArb = (split: SplitInput): fc.Arbitrary<SplitInput> => {
  const shuffle = <T>(xs: T[]) =>
    fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length });
  switch (split.method) {
    case 'equal':
      return shuffle(split.participants).map((participants) => ({ method: 'equal', participants }));
    case 'exact':
      return shuffle(split.amounts).map((amounts) => ({ method: 'exact', amounts }));
    case 'percent':
      return shuffle(split.basisPoints).map((basisPoints) => ({ method: 'percent', basisPoints }));
    case 'shares':
      return shuffle(split.shares).map((shares) => ({ method: 'shares', shares }));
  }
};

/** Integer weights behind a proportional split, keyed by user. */
function weightsOf(split: SplitInput): Map<string, number> | null {
  switch (split.method) {
    case 'equal':
      return new Map(split.participants.map((u) => [u, 1]));
    case 'percent':
      return new Map(split.basisPoints.map((p) => [p.userId, p.bp]));
    case 'shares':
      return new Map(split.shares.map((s) => [s.userId, s.shares]));
    case 'exact':
      return null;
  }
}

describe('computeShares properties', () => {
  it('shares always add up to the total, and every share is positive', () => {
    fc.assert(
      fc.property(caseArb, ({ total, split, seed }) => {
        const shares = computeShares(total, split, seed);
        expect(shares.reduce((s, l) => s + l.amount, 0)).toBe(total);
        expect(shares.every((l) => Number.isSafeInteger(l.amount) && l.amount > 0)).toBe(true);
      }),
      RUNS,
    );
  });

  it('is deterministic and independent of input order', () => {
    fc.assert(
      fc.property(
        caseArb.chain((c) => shuffledArb(c.split).map((shuffled) => ({ ...c, shuffled }))),
        ({ total, split, shuffled, seed }) => {
          const first = computeShares(total, split, seed);
          expect(computeShares(total, split, seed)).toEqual(first);
          expect(computeShares(total, shuffled, seed)).toEqual(first);
        },
      ),
      RUNS,
    );
  });

  it('no share differs from its exact proportional value by a whole minor unit or more', () => {
    fc.assert(
      fc.property(caseArb, ({ total, split, seed }) => {
        const weights = weightsOf(split);
        if (!weights) return; // exact splits are taken as given
        const W = [...weights.values()].reduce((s, w) => s + BigInt(w), 0n);
        const shares = new Map(computeShares(total, split, seed).map((l) => [l.userId, l.amount]));
        for (const [userId, w] of weights) {
          // |share − total·w/W| < 1  ⇔  |share·W − total·w| < W
          const diff = BigInt(shares.get(userId) ?? 0) * W - BigInt(total) * BigInt(w);
          expect(diff < W && -diff < W).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('percent splits use basis points that sum to exactly 100%', () => {
    fc.assert(
      fc.property(caseArb, ({ split }) => {
        if (split.method !== 'percent') return;
        expect(split.basisPoints.reduce((s, p) => s + p.bp, 0)).toBe(BASIS_POINTS_TOTAL);
      }),
      RUNS,
    );
  });
});

describe('allocateProportional properties', () => {
  it('spreads leftover units fairly: amounts differ by at most 1 for equal weights', () => {
    fc.assert(
      fc.property(usersArb(1, 20), totalArb(), seedArb, (users, total, seed) => {
        const amounts = allocateProportional(
          total,
          users.map((userId) => ({ userId, weight: 1 })),
          seed,
        ).map((l) => l.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
      }),
      RUNS,
    );
  });
});
