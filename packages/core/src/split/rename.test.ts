import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalSnapshot } from '../activity/diff';
import { InvariantViolation } from '../errors';
import { RUNS, seedArb, splitArb, totalArb, usersArb } from '../testing/arbitraries';
import type { Line } from '../types';
import { canonicalSplitInput, sameSplitInput } from './canonical';
import { computeShares, type SplitInput } from './computeShares';
import { renameInSplit, splitInputUsers } from './rename';

describe('renameInSplit', () => {
  it('replaces the user in an equal split, keeping the list sorted', () => {
    expect(renameInSplit({ method: 'equal', participants: ['a', 'p', 'm'] }, 'p', 'z')).toEqual({
      method: 'equal',
      participants: ['a', 'm', 'z'],
    });
  });

  it('replaces the user in exact amounts, percentages and shares, keeping each value', () => {
    expect(
      renameInSplit(
        {
          method: 'exact',
          amounts: [
            { userId: 'p', amount: 300 },
            { userId: 'a', amount: 700 },
          ],
        },
        'p',
        'z',
      ),
    ).toEqual({
      method: 'exact',
      amounts: [
        { userId: 'a', amount: 700 },
        { userId: 'z', amount: 300 },
      ],
    });
    expect(
      renameInSplit(
        {
          method: 'percent',
          basisPoints: [
            { userId: 'a', bp: 6667 },
            { userId: 'p', bp: 3333 },
          ],
        },
        'p',
        '0',
      ),
    ).toEqual({
      method: 'percent',
      basisPoints: [
        { userId: '0', bp: 3333 },
        { userId: 'a', bp: 6667 },
      ],
    });
    expect(
      renameInSplit(
        {
          method: 'shares',
          shares: [
            { userId: 'a', shares: 2 },
            { userId: 'p', shares: 1 },
          ],
        },
        'p',
        'b',
      ),
    ).toEqual({
      method: 'shares',
      shares: [
        { userId: 'a', shares: 2 },
        { userId: 'b', shares: 1 },
      ],
    });
  });

  it('returns a split without the user unchanged, in canonical form', () => {
    const split: SplitInput = {
      method: 'percent',
      basisPoints: [
        { bp: 4000, userId: 'm' }, // keys out of order, as jsonb returns them
        { userId: 'a', bp: 6000 },
      ],
    };
    const renamed = renameInSplit(split, 'p', 'z');
    expect(renamed).toEqual(canonicalSplitInput(split));
    expect(JSON.stringify(renamed)).toBe(JSON.stringify(canonicalSplitInput(split)));
  });

  it('refuses to rename someone to a person already in the split', () => {
    expect(() => renameInSplit({ method: 'equal', participants: ['a', 'p'] }, 'p', 'a')).toThrow(
      InvariantViolation,
    );
  });

  it('lists the users a split names', () => {
    expect(splitInputUsers({ method: 'equal', participants: ['b', 'a'] })).toEqual(['b', 'a']);
    expect(
      splitInputUsers({
        method: 'shares',
        shares: [
          { userId: 'a', shares: 1 },
          { userId: 'b', shares: 0 },
        ],
      }),
    ).toEqual(['a', 'b']);
  });
});

// ---- properties ---------------------------------------------------------------------------------

/** A split, the user to rename, and a new ID that isn't in it. */
const caseArb = fc
  .tuple(usersArb(1, 12), totalArb(), seedArb)
  .chain(([users, total, seed]) =>
    fc.record({
      users: fc.constant(users),
      total: fc.constant(total),
      seed: fc.constant(seed),
      split: splitArb(total, users),
      from: fc.constantFrom(...users),
      to: fc.string({ minLength: 1, maxLength: 7 }).filter((id) => !users.includes(id)),
    }),
  )
  .filter(({ split, from }) => splitInputUsers(split).includes(from));

/** Each (user, value) pair a split holds, as sortable strings. */
function entries(split: SplitInput, rename: (id: string) => string = (id) => id): string[] {
  const pair = (id: string, value: number) => JSON.stringify([rename(id), value]);
  switch (split.method) {
    case 'equal':
      return split.participants.map((u) => pair(u, 1)).sort();
    case 'exact':
      return split.amounts.map((a) => pair(a.userId, a.amount)).sort();
    case 'percent':
      return split.basisPoints.map((p) => pair(p.userId, p.bp)).sort();
    case 'shares':
      return split.shares.map((s) => pair(s.userId, s.shares)).sort();
  }
}

const amountOf = (lines: Line[], userId: string) =>
  lines.find((l) => l.userId === userId)?.amount ?? 0;

describe('renameInSplit (properties)', () => {
  it('changes only the renamed user: every other ID and every value stays', () => {
    fc.assert(
      fc.property(caseArb, ({ split, from, to }) => {
        const swap = (id: string) => (id === from ? to : id);
        expect(entries(renameInSplit(split, from, to))).toEqual(entries(split, swap));
        expect(splitInputUsers(renameInSplit(split, from, to))).not.toContain(from);
      }),
      RUNS,
    );
  });

  it('returns a canonical split, which canonicalSnapshot leaves exactly as it is', () => {
    fc.assert(
      fc.property(caseArb, ({ split, from, to, total }) => {
        const renamed = renameInSplit(split, from, to);
        const snapshot = canonicalSnapshot({
          description: 'x',
          amount: total,
          currency: 'INR',
          occurredOn: '2026-11-10',
          notes: null,
          splitMethod: renamed.method,
          splitInput: renamed,
          payers: [],
          shares: [],
        });
        expect(JSON.stringify(snapshot.splitInput)).toBe(JSON.stringify(renamed));
      }),
      RUNS,
    );
  });

  it('is undone by renaming back', () => {
    fc.assert(
      fc.property(caseArb, ({ split, from, to }) => {
        const back = renameInSplit(renameInSplit(split, from, to), to, from);
        expect(back).toEqual(canonicalSplitInput(split));
        expect(sameSplitInput(back, split)).toBe(true);
      }),
      RUNS,
    );
  });

  it('keeps the total, and gives everyone the same share to within one minor unit', () => {
    fc.assert(
      fc.property(caseArb, ({ split, from, to, total, seed }) => {
        const before = computeShares(total, split, seed);
        const after = computeShares(total, renameInSplit(split, from, to), seed);
        expect(after.reduce((sum, l) => sum + l.amount, 0)).toBe(total);
        for (const line of before) {
          const id = line.userId === from ? to : line.userId;
          expect(Math.abs(amountOf(after, id) - line.amount)).toBeLessThanOrEqual(1);
        }
        if (split.method === 'exact') {
          expect(after).toEqual(
            before
              .map((l) => (l.userId === from ? { ...l, userId: to } : l))
              .sort((a, b) => (a.userId < b.userId ? -1 : 1)),
          );
        }
      }),
      RUNS,
    );
  });

  it('gives identical shares when the new ID sorts in the same position', () => {
    // Nothing sorts strictly between an ID and the same ID followed by U+0000.
    fc.assert(
      fc.property(
        caseArb.filter(({ users, from }) => !users.includes(`${from}\u0000`)),
        ({ split, from, total, seed }) => {
          const to = `${from}\u0000`;
          const before = computeShares(total, split, seed);
          const after = computeShares(total, renameInSplit(split, from, to), seed);
          expect(after).toEqual(before.map((l) => (l.userId === from ? { ...l, userId: to } : l)));
        },
      ),
      RUNS,
    );
  });
});
