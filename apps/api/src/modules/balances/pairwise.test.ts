import { describe, expect, it } from 'vitest';
import { pairwiseBalances, toMoney } from './pairwise';

const row = (groupId: string, userId: string, net: number, currency = 'INR') => ({
  groupId,
  userId,
  currency,
  net,
});

describe('pairwiseBalances', () => {
  it('keeps the simplified transfers between me and each person', () => {
    // Goa: I'm owed 800; B owes 400, C owes 400.
    const balances = pairwiseBalances('me', [
      row('goa', 'me', 800),
      row('goa', 'b', -400),
      row('goa', 'c', -400),
    ]);
    expect(toMoney(balances.get('b'))).toEqual([{ amount: 400, currency: 'INR' }]);
    expect(toMoney(balances.get('c'))).toEqual([{ amount: 400, currency: 'INR' }]);
  });

  it('adds up across groups and keeps currencies apart', () => {
    const balances = pairwiseBalances('me', [
      row('goa', 'me', -300),
      row('goa', 'b', 300),
      row('flat', 'me', 500),
      row('flat', 'b', -500),
      row('trip', 'me', 1000, 'USD'),
      row('trip', 'b', -1000, 'USD'),
    ]);
    expect(toMoney(balances.get('b'))).toEqual([
      { amount: 200, currency: 'INR' },
      { amount: 1000, currency: 'USD' },
    ]);
  });

  it('ignores groups I have no balance in, and people I owe nothing to', () => {
    const balances = pairwiseBalances('me', [row('other', 'x', 100), row('other', 'y', -100)]);
    expect(balances.size).toBe(0);
  });

  it('sums to my own net in every group', () => {
    const nets = [
      row('g', 'me', 700),
      row('g', 'b', -200),
      row('g', 'c', -900),
      row('g', 'd', 400),
    ];
    const balances = pairwiseBalances('me', nets);
    const total = [...balances.values()].reduce((sum, m) => sum + (m.get('INR') ?? 0), 0);
    expect(total).toBe(700);
  });

  it('drops a balance that nets to zero across groups', () => {
    const balances = pairwiseBalances('me', [
      row('a', 'me', 100),
      row('a', 'b', -100),
      row('z', 'me', -100),
      row('z', 'b', 100),
    ]);
    expect(toMoney(balances.get('b'))).toEqual([]);
  });
});
