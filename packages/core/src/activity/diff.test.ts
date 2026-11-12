import { describe, expect, it } from 'vitest';
import type { SplitInput } from '../split/computeShares';
import { canonicalSnapshot, diffSnapshots, type TransactionSnapshot } from './diff';

const line = (userId: string, amount: number) => ({ userId, amount });

const base: TransactionSnapshot = {
  description: 'Dinner',
  amount: 120_000,
  currency: 'INR',
  occurredOn: '2026-11-02',
  notes: null,
  splitMethod: 'equal',
  splitInput: { method: 'equal', participants: ['a', 'b', 'c'] },
  payers: [line('b', 120_000)],
  shares: [line('a', 40_000), line('b', 40_000), line('c', 40_000)],
};

describe('diffSnapshots', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffSnapshots(base, { ...base })).toEqual([]);
  });

  it.each([
    ['description', 'Dinner at Thalassa'],
    ['currency', 'USD'],
    ['occurredOn', '2026-11-03'],
    ['notes', 'Includes dessert'],
    ['splitMethod', 'exact'],
  ] as const)('reports a %s change', (field, to) => {
    expect(diffSnapshots(base, { ...base, [field]: to })).toEqual([
      { field, from: base[field], to },
    ]);
  });

  it('reports notes being cleared', () => {
    expect(diffSnapshots({ ...base, notes: 'x' }, base)).toEqual([
      { field: 'notes', from: 'x', to: null },
    ]);
  });

  it('reports the amount change and the share changes it causes', () => {
    const after: TransactionSnapshot = {
      ...base,
      amount: 150_000,
      payers: [line('b', 150_000)],
      shares: [line('a', 50_000), line('b', 50_000), line('c', 50_000)],
    };
    expect(diffSnapshots(base, after)).toEqual([
      { field: 'amount', from: 120_000, to: 150_000 },
      {
        field: 'payers',
        added: [],
        removed: [],
        changed: [{ userId: 'b', from: 120_000, to: 150_000 }],
      },
      {
        field: 'shares',
        added: [],
        removed: [],
        changed: [
          { userId: 'a', from: 40_000, to: 50_000 },
          { userId: 'b', from: 40_000, to: 50_000 },
          { userId: 'c', from: 40_000, to: 50_000 },
        ],
      },
    ]);
  });

  it('reports people added to and removed from the split', () => {
    const after = { ...base, shares: [line('d', 40_000), line('b', 40_000), line('a', 40_000)] };
    expect(diffSnapshots(base, after)).toEqual([
      { field: 'shares', added: [line('d', 40_000)], removed: [line('c', 40_000)], changed: [] },
    ]);
  });

  it('reports a change of payer', () => {
    const after = { ...base, payers: [line('a', 120_000)] };
    expect(diffSnapshots(base, after)).toEqual([
      { field: 'payers', added: [line('a', 120_000)], removed: [line('b', 120_000)], changed: [] },
    ]);
  });

  it('lists changes in a fixed field order', () => {
    const after: TransactionSnapshot = {
      ...base,
      notes: 'n',
      description: 'D',
      occurredOn: '2026-01-01',
      currency: 'USD',
      amount: 1,
      splitMethod: 'shares',
    };
    expect(diffSnapshots(base, after).map((c) => c.field)).toEqual([
      'description',
      'amount',
      'currency',
      'occurredOn',
      'notes',
      'splitMethod',
    ]);
  });

  describe('settlements', () => {
    // Bilal pays Asha ₹950 by UPI.
    const settlement: TransactionSnapshot = {
      description: 'Settlement',
      amount: 95_000,
      currency: 'INR',
      occurredOn: '2026-11-04',
      notes: null,
      splitMethod: null,
      splitInput: null,
      payers: [line('b', 95_000)],
      shares: [line('a', 95_000)],
      paymentMethod: 'upi',
      paymentRef: null,
    };

    it('reports a change of method, and of reference, after the other fields', () => {
      const after: TransactionSnapshot = {
        ...settlement,
        notes: 'n',
        paymentMethod: 'cash',
        paymentRef: 'UTR 123',
      };
      expect(diffSnapshots(settlement, after)).toEqual([
        { field: 'notes', from: null, to: 'n' },
        { field: 'paymentMethod', from: 'upi', to: 'cash' },
        { field: 'paymentRef', from: null, to: 'UTR 123' },
      ]);
    });

    it('reports a reference being cleared', () => {
      expect(diffSnapshots({ ...settlement, paymentRef: 'UTR 1' }, settlement)).toEqual([
        { field: 'paymentRef', from: 'UTR 1', to: null },
      ]);
    });

    it('reports nothing when nothing changed', () => {
      expect(diffSnapshots(settlement, { ...settlement })).toEqual([]);
    });

    it('treats an expense’s missing payment fields as null, so expenses diff as before', () => {
      expect(diffSnapshots(base, { ...base, paymentRef: null })).toEqual([]);
    });
  });
});

describe('canonicalSnapshot', () => {
  it('sorts payers and shares by userId without mutating the input', () => {
    const messy = {
      ...base,
      shares: [line('c', 1), line('a', 2)],
      payers: [line('z', 2), line('b', 1)],
    };
    const result = canonicalSnapshot(messy);
    expect(result.shares.map((l) => l.userId)).toEqual(['a', 'c']);
    expect(result.payers.map((l) => l.userId)).toEqual(['b', 'z']);
    expect(messy.shares.map((l) => l.userId)).toEqual(['c', 'a']);
  });

  it.each<[string, SplitInput, SplitInput]>([
    [
      'equal',
      { method: 'equal', participants: ['c', 'a'] },
      { method: 'equal', participants: ['a', 'c'] },
    ],
    [
      'exact',
      { method: 'exact', amounts: [line('c', 1), line('a', 2)] },
      { method: 'exact', amounts: [line('a', 2), line('c', 1)] },
    ],
    [
      'percent',
      {
        method: 'percent',
        basisPoints: [
          { userId: 'c', bp: 1 },
          { userId: 'a', bp: 9_999 },
        ],
      },
      {
        method: 'percent',
        basisPoints: [
          { userId: 'a', bp: 9_999 },
          { userId: 'c', bp: 1 },
        ],
      },
    ],
    [
      'shares',
      {
        method: 'shares',
        shares: [
          { userId: 'c', shares: 1 },
          { userId: 'a', shares: 2 },
        ],
      },
      {
        method: 'shares',
        shares: [
          { userId: 'a', shares: 2 },
          { userId: 'c', shares: 1 },
        ],
      },
    ],
  ])('sorts a %s split input', (_, input, expected) => {
    expect(canonicalSnapshot({ ...base, splitInput: input }).splitInput).toEqual(expected);
  });

  it('keeps a null split input (settlements)', () => {
    expect(
      canonicalSnapshot({ ...base, splitMethod: null, splitInput: null }).splitInput,
    ).toBeNull();
  });

  it('makes equivalent snapshots serialize identically', () => {
    const shuffled = { ...base, shares: [...base.shares].reverse() };
    expect(JSON.stringify(canonicalSnapshot(shuffled))).toBe(
      JSON.stringify(canonicalSnapshot(base)),
    );
  });
});
