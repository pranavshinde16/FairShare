// prepareExpense keeps an edit's stored shares when its amount and split input are unchanged
// (they can differ from a recompute by a paisa after a placeholder is claimed), and recomputes
// whenever either changes.

import type { UpdateExpense } from '@fairshare/contracts';
import { computeShares, type Line } from '@fairshare/core';
import { describe, expect, it } from 'vitest';
import { prepareExpense, type StoredSplit } from './service';

const ID = '01a1de17-e336-7320-8a30-1fd6d6a394e9';
const [A, B, C] = [
  '01a1de17-0000-7000-8000-00000000000a',
  '01a1de17-0000-7000-8000-00000000000b',
  '01a1de17-0000-7000-8000-00000000000c',
];

const body = (amount: number, participants: string[]): UpdateExpense => ({
  description: 'Dinner',
  amount,
  currency: 'INR',
  occurredOn: '2026-11-10',
  payers: [{ userId: A, amount }],
  split: { method: 'equal', participants },
});

/** Stored shares that differ from a recompute by a paisa, as after a claim. */
function drifted(amount: number, participants: string[]): Line[] {
  const shares = computeShares(amount, { method: 'equal', participants }, ID);
  const more = shares.findIndex((l) => l.amount > Math.floor(amount / participants.length));
  const less = shares.findIndex((_, i) => i !== more);
  return shares.map((l, i) =>
    i === more ? { ...l, amount: l.amount - 1 } : i === less ? { ...l, amount: l.amount + 1 } : l,
  );
}

describe('prepareExpense', () => {
  it('keeps the stored shares when the amount and split input are unchanged', () => {
    const shares = drifted(100000, [A, B, C]);
    const stored: StoredSplit = {
      amount: 100000,
      splitInput: { method: 'equal', participants: [C, A, B] }, // any order: compared canonically
      shares,
    };

    expect(prepareExpense(ID, body(100000, [A, B, C]), stored).lines.shares).toEqual(shares);
  });

  it('recomputes when the split input changes', () => {
    const stored: StoredSplit = {
      amount: 100000,
      splitInput: { method: 'equal', participants: [A, B, C] },
      shares: drifted(100000, [A, B, C]),
    };

    expect(prepareExpense(ID, body(100000, [A, B]), stored).lines.shares).toEqual(
      computeShares(100000, { method: 'equal', participants: [A, B] }, ID),
    );
  });

  it('recomputes when the amount changes', () => {
    const stored: StoredSplit = {
      amount: 100000,
      splitInput: { method: 'equal', participants: [A, B, C] },
      shares: drifted(100000, [A, B, C]),
    };

    expect(prepareExpense(ID, body(100001, [A, B, C]), stored).lines.shares).toEqual(
      computeShares(100001, { method: 'equal', participants: [A, B, C] }, ID),
    );
  });

  it('recomputes when nothing is stored, as for a create, or there was no split input', () => {
    const expected = computeShares(100000, { method: 'equal', participants: [A, B, C] }, ID);

    expect(prepareExpense(ID, body(100000, [A, B, C])).lines.shares).toEqual(expected);
    expect(
      prepareExpense(ID, body(100000, [A, B, C]), {
        amount: 100000,
        splitInput: null,
        shares: drifted(100000, [A, B, C]),
      }).lines.shares,
    ).toEqual(expected);
  });
});
