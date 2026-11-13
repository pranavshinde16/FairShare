import type { GroupBalances } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { breakdownLine, hasTransactions } from './summaries';

const ME = '00000000-0000-7000-8000-000000000001';
const PRIYA = '00000000-0000-7000-8000-000000000002';
const NEHA = '00000000-0000-7000-8000-000000000003';
const RAHUL = '00000000-0000-7000-8000-000000000004';
const user = (id: string, name: string) => ({
  user: { id, name, avatarUrl: null, isPlaceholder: false, isDeleted: false },
});
const group = {
  currency: 'INR',
  members: [
    user(ME, 'Asha Kapoor'),
    user(PRIYA, 'Priya Nair'),
    user(NEHA, 'Neha Joshi'),
    user(RAHUL, 'Rahul Mehta'),
  ],
} as unknown as Parameters<typeof breakdownLine>[1];

const zero = { amount: 0, currency: 'INR' };
function balances(me: Partial<GroupBalances['me']>, paid = 0): GroupBalances {
  return {
    balances: [],
    me: { net: [], owes: [], owed: [], ...me },
    breakdown: [
      {
        userId: ME,
        paid: { amount: paid, currency: 'INR' },
        share: zero,
        sent: zero,
        received: zero,
      },
    ],
  };
}
const t = (from: string, to: string, amount: number) => ({ from, to, amount, currency: 'INR' });

describe('breakdownLine', () => {
  it('names the one person who owes me, with the amount', () => {
    expect(breakdownLine(balances({ owed: [t(PRIYA, ME, 555_000)] }), group)).toEqual({
      text: 'Priya N. owes you',
      amount: { amount: 555_000, currency: 'INR' },
      tone: 'owed',
    });
  });

  it('names two people without an amount, and shortens a longer list', () => {
    const two = breakdownLine(balances({ owed: [t(NEHA, ME, 100), t(RAHUL, ME, 200)] }), group);
    expect(two).toEqual({ text: 'Neha J. and Rahul M. owe you', amount: null, tone: 'owed' });
    const three = breakdownLine(
      balances({ owed: [t(NEHA, ME, 100), t(RAHUL, ME, 200), t(PRIYA, ME, 300)] }),
      group,
    );
    expect(three?.text).toBe('Neha J. and 2 others owe you');
  });

  it('says who I owe', () => {
    expect(breakdownLine(balances({ owes: [t(ME, RAHUL, 45_000)] }), group)).toEqual({
      text: 'You owe Rahul M.',
      amount: { amount: 45_000, currency: 'INR' },
      tone: 'owe',
    });
  });

  it('is empty when I’m settled, or only owe in another currency', () => {
    expect(breakdownLine(balances({}), group)).toBeNull();
    expect(
      breakdownLine(balances({ owes: [{ ...t(ME, RAHUL, 100), currency: 'USD' }] }), group),
    ).toBeNull();
  });
});

describe('hasTransactions', () => {
  it('tells a group with expenses from one with none', () => {
    expect(hasTransactions(balances({}, 0))).toBe(false);
    expect(hasTransactions(balances({}, 120_000))).toBe(true);
  });
});
