// fast-check generators shared by the property tests. Test-only: never exported from the package.

import fc from 'fast-check';
import { settlementLines } from '../ledger/ledger';
import type { LedgerTransaction } from '../ledger/types';
import { MAX_AMOUNT_MINOR } from '../money/constants';
import { computeShares, type SplitInput } from '../split/computeShares';
import { validatePayers } from '../split/payers';
import type { Line } from '../types';

/** The plan requires 1,000+ cases per property. */
export const RUNS = { numRuns: 1_000 } as const;

export const userIdArb = fc.string({ minLength: 1, maxLength: 6 });

export const usersArb = (minLength = 1, maxLength = 20) =>
  fc.uniqueArray(userIdArb, { minLength, maxLength });

export const seedArb = fc.string({ maxLength: 40 });

/** Biased toward small totals, where rounding edge cases live, while still covering the cap. */
export const totalArb = (max = MAX_AMOUNT_MINOR) =>
  fc.oneof(fc.integer({ min: 1, max: Math.min(100, max) }), fc.integer({ min: 1, max }));

/**
 * `total` cut into `parts` integers that add up to it. With `positive`, every part is ≥ 1
 * (requires total ≥ parts); otherwise parts may be 0.
 */
export function partitionArb(
  total: number,
  parts: number,
  positive: boolean,
): fc.Arbitrary<number[]> {
  if (parts === 1) return fc.constant([total]);
  const cuts = positive
    ? fc.uniqueArray(fc.integer({ min: 1, max: total - 1 }), {
        minLength: parts - 1,
        maxLength: parts - 1,
      })
    : fc.array(fc.integer({ min: 0, max: total }), { minLength: parts - 1, maxLength: parts - 1 });
  return cuts.map((c) => {
    const points = [0, ...c.sort((a, b) => a - b), total];
    return points.slice(1).map((p, i) => p - points[i]!);
  });
}

/** Any valid split of `total` among some or all of `users`, using any of the four methods. */
export function splitArb(total: number, users: string[]): fc.Arbitrary<SplitInput> {
  const n = users.length;
  return fc.oneof(
    fc
      .subarray(users, { minLength: 1 })
      .map((participants): SplitInput => ({ method: 'equal', participants })),
    fc
      .array(fc.integer({ min: 0, max: 1_000 }), { minLength: n, maxLength: n })
      .filter((weights) => weights.some((w) => w > 0))
      .map((weights): SplitInput => ({
        method: 'shares',
        shares: users.map((userId, i) => ({ userId, shares: weights[i]! })),
      })),
    partitionArb(10_000, n, false).map((bps): SplitInput => ({
      method: 'percent',
      basisPoints: users.map((userId, i) => ({ userId, bp: bps[i]! })),
    })),
    partitionArb(total, n, false).map((amounts): SplitInput => ({
      method: 'exact',
      amounts: users.map((userId, i) => ({ userId, amount: amounts[i]! })),
    })),
  );
}

/** One or more payers among `users`, each paying a positive part of `total`. */
export function payersArb(total: number, users: string[]): fc.Arbitrary<Line[]> {
  return fc
    .subarray(users, { minLength: 1, maxLength: Math.min(users.length, total) })
    .chain((payers) =>
      partitionArb(total, payers.length, true).map((amounts) =>
        payers.map((userId, i) => ({ userId, amount: amounts[i]! })),
      ),
    );
}

export type ExpenseSpec = {
  kind: 'expense';
  id: string;
  currency: string;
  total: number;
  payers: Line[];
  split: SplitInput;
};

export type SettlementSpec = {
  kind: 'settlement';
  id: string;
  currency: string;
  from: string;
  to: string;
  amount: number;
};

export type Spec = ExpenseSpec | SettlementSpec;

export function expenseArb(
  users: string[],
  maxTotal = MAX_AMOUNT_MINOR,
): fc.Arbitrary<ExpenseSpec> {
  return fc
    .tuple(fc.uuid(), fc.constantFrom('INR', 'USD'), totalArb(maxTotal))
    .chain(([id, currency, total]) =>
      fc.record({
        kind: fc.constant('expense' as const),
        id: fc.constant(id),
        currency: fc.constant(currency),
        total: fc.constant(total),
        payers: payersArb(total, users),
        split: splitArb(total, users),
      }),
    );
}

/** Builds the transaction exactly as the server will: validated payers plus engine-computed shares. */
export function build(spec: Spec): LedgerTransaction {
  if (spec.kind === 'settlement') {
    return {
      id: spec.id,
      type: 'settlement',
      currency: spec.currency,
      amount: spec.amount,
      ...settlementLines({ fromUserId: spec.from, toUserId: spec.to, amount: spec.amount }),
    };
  }
  return {
    id: spec.id,
    type: 'expense',
    currency: spec.currency,
    amount: spec.total,
    payers: validatePayers(spec.total, spec.payers),
    shares: computeShares(spec.total, spec.split, spec.id),
  };
}

// ---- Sequences of group operations ---------------------------------------------------------------

export type Op =
  | { op: 'create'; spec: ExpenseSpec }
  | { op: 'settle'; from: number; to: number; amount: number; currency: string }
  | { op: 'edit'; index: number; spec: ExpenseSpec }
  | { op: 'delete'; index: number }
  | { op: 'restore'; index: number };

export type Entry = { spec: Spec; deleted: boolean };

export type Scenario = { members: string[]; entries: Entry[] };

/** A group of 2–8 members after a random sequence of creates, settlements, edits, deletes and restores. */
export const scenarioArb: fc.Arbitrary<Scenario> = usersArb(2, 8).chain((members) => {
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    {
      weight: 4,
      arbitrary: expenseArb(members, 10_000_000).map((spec) => ({ op: 'create' as const, spec })),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constant('settle' as const),
        from: fc.nat(),
        to: fc.nat(),
        amount: fc.integer({ min: 1, max: 10_000_000 }),
        currency: fc.constantFrom('INR', 'USD'),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        op: fc.constant('edit' as const),
        index: fc.nat(),
        spec: expenseArb(members, 10_000_000),
      }),
    },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('delete' as const), index: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ op: fc.constant('restore' as const), index: fc.nat() }) },
  );
  return fc
    .array(opArb, { maxLength: 25 })
    .map((ops) => ({ members, entries: applyOps(members, ops) }));
});

function applyOps(members: string[], ops: Op[]): Entry[] {
  const entries: Entry[] = [];
  ops.forEach((o, step) => {
    const target = entries.length > 0 && 'index' in o ? entries[o.index % entries.length]! : null;
    switch (o.op) {
      case 'create':
        entries.push({ spec: o.spec, deleted: false });
        break;
      case 'settle': {
        const from = members[o.from % members.length]!;
        const to = members[(o.from + 1 + (o.to % (members.length - 1))) % members.length]!;
        entries.push({
          spec: {
            kind: 'settlement',
            id: `s-${step}`,
            currency: o.currency,
            from,
            to,
            amount: o.amount,
          },
          deleted: false,
        });
        break;
      }
      case 'edit':
        // Expenses are edited into expenses; settlements are edited through their own form.
        if (target?.spec.kind === 'expense') target.spec = { ...o.spec, id: target.spec.id };
        break;
      case 'delete':
        if (target) target.deleted = true;
        break;
      case 'restore':
        if (target) target.deleted = false;
        break;
    }
  });
  return entries;
}

export const active = (entries: Entry[]) =>
  entries.filter((e) => !e.deleted).map((e) => build(e.spec));

/** A deep copy, so a "revert" rebuilds from equal data rather than reusing the same objects. */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
