import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import { A, B, C, D, dinner, dinnerCorrected, fuel, hotel, settlement } from '../testing/goa';
import { ledgerLines, netsFromTransactions, settlementLines } from './ledger';
import type { LedgerTransaction } from './types';

const line = (userId: string, amount: number) => ({ userId, amount });
const inr = (...nets: [string, number][]) => [
  { currency: 'INR', nets: nets.map(([u, a]) => line(u, a)) },
];

describe('ledgerLines', () => {
  it('one payer, equal split: A pays ₹1,200 for A/B/C → A +800, B −400, C −400', () => {
    expect(
      ledgerLines({
        payers: [line(A, 120_000)],
        shares: [line(A, 40_000), line(B, 40_000), line(C, 40_000)],
      }),
    ).toEqual([line(A, 80_000), line(B, -40_000), line(C, -40_000)]);
  });

  it('one pays for all: the Goa hotel', () => {
    expect(ledgerLines(hotel)).toEqual([
      line(A, 300_000),
      line(B, -100_000),
      line(C, -100_000),
      line(D, -100_000),
    ]);
  });

  it('subset split: the dinner leaves D out entirely', () => {
    expect(ledgerLines(dinner)).toEqual([line(A, -40_000), line(B, 80_000), line(C, -40_000)]);
  });

  it('multiple payers: the fuel', () => {
    expect(ledgerLines(fuel)).toEqual([
      line(A, -75_000),
      line(B, -75_000),
      line(C, 125_000),
      line(D, 25_000),
    ]);
  });

  it('a settlement: B pays A ₹950 → B +950, A −950', () => {
    expect(ledgerLines(settlement)).toEqual([line(A, -95_000), line(B, 95_000)]);
  });

  it('omits someone who paid exactly their own share', () => {
    expect(
      ledgerLines({ payers: [line(A, 100), line(B, 100)], shares: [line(A, 100), line(B, 100)] }),
    ).toEqual([]);
  });
});

describe('netsFromTransactions', () => {
  it('reproduces the Goa balances: A +1,850, B −950, C −150, D −750', () => {
    expect(netsFromTransactions([hotel, dinner, fuel])).toEqual(
      inr([A, 185_000], [B, -95_000], [C, -15_000], [D, -75_000]),
    );
  });

  it('after B settles ₹950 with A: A +900, B settled, C −150, D −750', () => {
    expect(netsFromTransactions([hotel, dinner, fuel, settlement])).toEqual(
      inr([A, 90_000], [C, -15_000], [D, -75_000]),
    );
  });

  it('editing the dinner to ₹1,500 after the settlement: A +800, B +200, C −250, D −750', () => {
    expect(netsFromTransactions([hotel, dinnerCorrected, fuel, settlement])).toEqual(
      inr([A, 80_000], [B, 20_000], [C, -25_000], [D, -75_000]),
    );
  });

  it('an overpaying settlement flips the direction instead of failing', () => {
    const overpay = settlementLines({ fromUserId: B, toUserId: A, amount: 115_000 });
    expect(netsFromTransactions([hotel, dinner, fuel, { currency: 'INR', ...overpay }])).toEqual(
      inr([A, 70_000], [B, 20_000], [C, -15_000], [D, -75_000]),
    );
  });

  it('keeps currencies separate and sorted, never summing across them', () => {
    const usd: LedgerTransaction = { ...dinner, id: 'usd', currency: 'USD' };
    expect(netsFromTransactions([usd, dinner]).map((c) => c.currency)).toEqual(['INR', 'USD']);
    expect(netsFromTransactions([usd, dinner])[1]!.nets).toEqual(ledgerLines(dinner));
  });

  it('returns nothing for no transactions', () => {
    expect(netsFromTransactions([])).toEqual([]);
  });

  it('detects an unbalanced transaction as an invariant violation', () => {
    const broken = { currency: 'INR', payers: [line(A, 100)], shares: [line(B, 90)] };
    expect(() => netsFromTransactions([broken])).toThrow(InvariantViolation);
  });
});

describe('settlementLines', () => {
  it('builds one payer row and one recipient row of the same amount', () => {
    expect(settlementLines({ fromUserId: B, toUserId: A, amount: 95_000 })).toEqual({
      payers: [line(B, 95_000)],
      shares: [line(A, 95_000)],
    });
  });

  it('rejects a payment to yourself', () => {
    expect(() => settlementLines({ fromUserId: A, toUserId: A, amount: 1 })).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_SAME_USER' }) as Error,
    );
  });

  it('rejects a non-positive amount', () => {
    expect(() => settlementLines({ fromUserId: A, toUserId: B, amount: 0 })).toThrow(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }) as Error,
    );
  });
});
