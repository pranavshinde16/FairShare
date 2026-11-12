import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_VERBS,
  ActivityEntry,
  ActivityFeed,
  TransactionHistory,
  TransactionSnapshot,
} from './activity';
import { Balances, GroupBalances } from './balances';
import {
  activityEntry,
  expectValid,
  expenseTransaction,
  ids,
  rejectedPaths,
  withField,
} from './testing/fixtures';

const inr = (amount: number) => ({ amount, currency: 'INR' });

describe('Balances', () => {
  // The Goa example: A +1,850, B −950, C −150, D −750.
  const goa = {
    currency: 'INR',
    nets: [
      { userId: ids.a, amount: 185_000 },
      { userId: ids.b, amount: -95_000 },
      { userId: ids.c, amount: -15_000 },
      { userId: ids.d, amount: -75_000 },
    ],
    transfers: [
      { from: ids.b, to: ids.a, amount: 95_000 },
      { from: ids.d, to: ids.a, amount: 75_000 },
      { from: ids.c, to: ids.a, amount: 15_000 },
    ],
  };

  it('accepts signed nets and positive transfers', () => expectValid(Balances, goa));

  it('rejects a zero or fractional transfer', () => {
    expect(
      rejectedPaths(Balances, { ...goa, transfers: [{ from: ids.b, to: ids.a, amount: 0 }] }),
    ).toEqual(['transfers.0.amount']);
    expect(Balances.safeParse({ ...goa, nets: [{ userId: ids.a, amount: 0.5 }] }).success).toBe(
      false,
    );
  });

  it('gives the caller their own view, with currencies on loose transfers', () => {
    expectValid(GroupBalances, {
      balances: [goa],
      me: {
        net: [inr(-95_000)],
        owes: [{ from: ids.b, to: ids.a, amount: 95_000, currency: 'INR' }],
        owed: [],
      },
      breakdown: [
        {
          userId: ids.b,
          paid: inr(120_000),
          share: inr(215_000),
          sent: inr(0),
          received: inr(0),
        },
      ],
    });
    expect(
      GroupBalances.safeParse({
        balances: [],
        me: { net: [], owes: [{ from: ids.b, to: ids.a, amount: 1 }], owed: [] },
        breakdown: [],
      }).success,
    ).toBe(false);
    // Settlement money is reported apart from expenses, so paid − share alone isn't the net.
    expect(
      GroupBalances.safeParse({
        balances: [],
        me: { net: [], owes: [], owed: [] },
        breakdown: [{ userId: ids.b, paid: inr(120_000), share: inr(215_000) }],
      }).success,
    ).toBe(false);
  });
});

describe('ActivityEntry', () => {
  it('accepts an entry', () => expectValid(ActivityEntry, activityEntry));

  it('accepts every tracked verb and rejects others', () => {
    for (const verb of ACTIVITY_VERBS) expectValid(ActivityEntry, { ...activityEntry, verb });
    expect(
      rejectedPaths(ActivityEntry, withField(activityEntry, { verb: 'transaction.viewed' })),
    ).toEqual(['verb']);
  });

  it.each([
    [{ entityType: 'user' }, 'entityType'],
    [{ id: 0 }, 'id'],
    [{ before: 'x' }, 'before'],
    [{ involvesMe: undefined }, 'involvesMe'],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(ActivityEntry, withField(activityEntry, patch))).toEqual([path]),
  );

  it('pages the feed with an unread count', () => {
    expectValid(ActivityFeed, { items: [activityEntry], nextCursor: null, unreadCount: 3 });
    expect(ActivityFeed.safeParse({ items: [], nextCursor: null }).success).toBe(false);
    expectValid(TransactionHistory, { items: [activityEntry] });
  });
});

describe('TransactionSnapshot', () => {
  const snapshot = {
    description: expenseTransaction.description,
    amount: expenseTransaction.amount,
    currency: expenseTransaction.currency,
    occurredOn: expenseTransaction.occurredOn,
    notes: null,
    splitMethod: 'equal',
    splitInput: expenseTransaction.splitInput,
    payers: expenseTransaction.payers,
    shares: expenseTransaction.shares,
  };

  it('accepts expense and settlement snapshots', () => {
    expectValid(TransactionSnapshot, snapshot);
    expectValid(TransactionSnapshot, { ...snapshot, splitMethod: null, splitInput: null });
  });

  it('rejects a snapshot with a missing field', () => {
    const { shares: _shares, ...partial } = snapshot;
    expect(rejectedPaths(TransactionSnapshot, partial)).toEqual(['shares']);
  });
});
