// Property-based tests for the ledger and balances (plan §10.3), 1,000 random cases each.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertTransactionInvariants } from '../invariants/transaction';
import { simplify } from '../simplify/simplify';
import {
  active,
  build,
  clone,
  expenseArb,
  RUNS,
  scenarioArb,
  usersArb,
  type Spec,
} from '../testing/arbitraries';
import { ledgerLines, netsFromTransactions } from './ledger';

const sum = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

describe('ledger properties', () => {
  it('every transaction the engine builds passes its invariants and its ledger sums to 0', () => {
    fc.assert(
      fc.property(
        usersArb(1, 20).chain((users) => expenseArb(users)),
        (spec) => {
          const tx = build(spec);
          assertTransactionInvariants(tx);
          expect(sum(ledgerLines(tx))).toBe(0);
        },
      ),
      RUNS,
    );
  });

  it('after any sequence of operations, every currency nets to exactly 0', () => {
    fc.assert(
      fc.property(scenarioArb, ({ entries }) => {
        for (const { nets } of netsFromTransactions(active(entries))) {
          expect(sum(nets)).toBe(0);
        }
      }),
      RUNS,
    );
  });

  it('editing an expense and then reverting it restores identical balances', () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((s) =>
          fc.record({
            scenario: fc.constant(s),
            pick: fc.nat(),
            edit: expenseArb(s.members, 10_000_000),
          }),
        ),
        ({ scenario: { entries }, pick, edit }) => {
          const expenses = entries.filter((e) => e.spec.kind === 'expense');
          if (expenses.length === 0) return;
          const target = expenses[pick % expenses.length]!;
          const original: Spec = clone(target.spec);
          const before = netsFromTransactions(active(entries));

          target.spec = { ...edit, id: original.id };
          netsFromTransactions(active(entries));
          target.spec = clone(original);

          expect(netsFromTransactions(active(entries))).toEqual(before);
        },
      ),
      RUNS,
    );
  });

  it('deleting a transaction and restoring it restores identical balances', () => {
    fc.assert(
      fc.property(
        scenarioArb.chain((s) => fc.record({ scenario: fc.constant(s), pick: fc.nat() })),
        ({ scenario: { entries }, pick }) => {
          if (entries.length === 0) return;
          const target = entries[pick % entries.length]!;
          target.deleted = false;
          const before = netsFromTransactions(active(entries));

          target.deleted = true;
          netsFromTransactions(active(entries));
          target.deleted = false;

          expect(netsFromTransactions(active(entries))).toEqual(before);
        },
      ),
      RUNS,
    );
  });

  it('recording every suggested transfer as a settlement settles the whole group', () => {
    fc.assert(
      fc.property(scenarioArb, ({ entries }) => {
        const txs = active(entries);
        const settlements = netsFromTransactions(txs).flatMap(({ currency, nets }) =>
          simplify(nets).map((t, i) =>
            build({
              kind: 'settlement',
              id: `settle-${currency}-${i}`,
              currency,
              from: t.from,
              to: t.to,
              amount: t.amount,
            }),
          ),
        );
        for (const { nets } of netsFromTransactions([...txs, ...settlements])) {
          expect(nets).toEqual([]);
        }
      }),
      RUNS,
    );
  });
});
