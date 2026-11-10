import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import { netsFromTransactions } from '../ledger/ledger';
import { A, B, C, D, dinner, fuel, hotel } from '../testing/goa';
import { simplify } from './simplify';

const nets = (...entries: [string, number][]) =>
  entries.map(([userId, amount]) => ({ userId, amount }));

describe('simplify', () => {
  it('returns no transfers for an empty or fully settled group', () => {
    expect(simplify([])).toEqual([]);
    expect(simplify(nets(['a', 0], ['b', 0]))).toEqual([]);
  });

  it('settles two people with one transfer', () => {
    expect(simplify(nets(['a', 500], ['b', -500]))).toEqual([{ from: 'b', to: 'a', amount: 500 }]);
  });

  it('settles the Goa trip with three transfers: B → A ₹950, D → A ₹750, C → A ₹150', () => {
    const goa = netsFromTransactions([hotel, dinner, fuel])[0]!.nets;
    expect(simplify(goa)).toEqual([
      { from: B, to: A, amount: 95_000 },
      { from: D, to: A, amount: 75_000 },
      { from: C, to: A, amount: 15_000 },
    ]);
  });

  it('pays several creditors from one debtor, largest first', () => {
    expect(simplify(nets(['d', -600], ['a', 300], ['b', 200], ['c', 100]))).toEqual([
      { from: 'd', to: 'a', amount: 300 },
      { from: 'd', to: 'b', amount: 200 },
      { from: 'd', to: 'c', amount: 100 },
    ]);
  });

  it('collapses a chain: A owes B and B owes C becomes A pays C', () => {
    expect(simplify(nets(['a', -100], ['b', 0], ['c', 100]))).toEqual([
      { from: 'a', to: 'c', amount: 100 },
    ]);
  });

  it('breaks ties by userId, whatever the input order', () => {
    const expected = [
      { from: 'a', to: 'c', amount: 100 },
      { from: 'b', to: 'd', amount: 100 },
    ];
    expect(simplify(nets(['a', -100], ['b', -100], ['c', 100], ['d', 100]))).toEqual(expected);
    expect(simplify(nets(['d', 100], ['c', 100], ['b', -100], ['a', -100]))).toEqual(expected);
  });

  it('re-queues partial balances in sorted position', () => {
    // Exercises re-insertion both at the end of a list and before a smaller balance.
    expect(simplify(nets(['a', 600], ['b', 500], ['c', 100], ['x', -300], ['y', -900]))).toEqual([
      { from: 'y', to: 'a', amount: 600 },
      { from: 'x', to: 'b', amount: 300 },
      { from: 'y', to: 'b', amount: 200 },
      { from: 'y', to: 'c', amount: 100 },
    ]);
  });

  it('throws when the nets do not sum to zero, because that is a bug', () => {
    expect(() => simplify(nets(['a', 100], ['b', -90]))).toThrow(InvariantViolation);
  });

  it('throws when a person appears twice', () => {
    expect(() => simplify(nets(['a', 100], ['a', -100]))).toThrow(InvariantViolation);
  });

  it('throws on a non-integer balance', () => {
    expect(() => simplify(nets(['a', 0.5], ['b', -0.5]))).toThrow(InvariantViolation);
  });
});
