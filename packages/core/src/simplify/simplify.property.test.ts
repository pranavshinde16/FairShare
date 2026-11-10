// Property-based tests for debt simplification (plan §10.3), 1,000 random cases each.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_MINOR } from '../money/constants';
import { RUNS, usersArb } from '../testing/arbitraries';
import type { Line } from '../types';
import { simplify } from './simplify';

/** Random balances for up to 20 people that sum to exactly zero. */
const netsArb: fc.Arbitrary<Line[]> = usersArb(0, 20).chain((users) =>
  fc
    .array(
      fc.oneof(
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.integer({ min: -MAX_AMOUNT_MINOR, max: MAX_AMOUNT_MINOR }),
      ),
      {
        minLength: Math.max(users.length - 1, 0),
        maxLength: Math.max(users.length - 1, 0),
      },
    )
    .map((values) => {
      const last = -values.reduce((s, v) => s + v, 0);
      return users.map((userId, i) => ({ userId, amount: i < values.length ? values[i]! : last }));
    }),
);

describe('simplify properties', () => {
  it('applying the transfers settles every balance exactly', () => {
    fc.assert(
      fc.property(netsArb, (nets) => {
        const balance = new Map(nets.map((n) => [n.userId, n.amount]));
        for (const t of simplify(nets)) {
          balance.set(t.from, balance.get(t.from)! + t.amount);
          balance.set(t.to, balance.get(t.to)! - t.amount);
        }
        expect([...balance.values()].every((b) => b === 0)).toBe(true);
      }),
      RUNS,
    );
  });

  it('uses at most n − 1 transfers, each positive, between real debtors and creditors', () => {
    fc.assert(
      fc.property(netsArb, (nets) => {
        const transfers = simplify(nets);
        const nonZero = nets.filter((n) => n.amount !== 0);
        expect(transfers.length).toBeLessThanOrEqual(Math.max(nonZero.length - 1, 0));
        const net = new Map(nets.map((n) => [n.userId, n.amount]));
        for (const t of transfers) {
          expect(t.amount).toBeGreaterThan(0);
          expect(net.get(t.from)!).toBeLessThan(0);
          expect(net.get(t.to)!).toBeGreaterThan(0);
        }
      }),
      RUNS,
    );
  });

  it('is deterministic whatever order the balances arrive in', () => {
    fc.assert(
      fc.property(
        netsArb.chain((nets) =>
          fc
            .shuffledSubarray(nets, { minLength: nets.length, maxLength: nets.length })
            .map((shuffled) => ({ nets, shuffled })),
        ),
        ({ nets, shuffled }) => {
          expect(simplify(shuffled)).toEqual(simplify(nets));
        },
      ),
      RUNS,
    );
  });
});
