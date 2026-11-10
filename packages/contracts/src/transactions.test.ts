import { MAX_AMOUNT_MINOR } from '@fairshare/core';
import { describe, expect, it } from 'vitest';
import {
  expectValid,
  createExpense,
  createSettlement,
  expenseTransaction,
  ids,
  rejectedPaths,
  settlementTransaction,
  uuid,
  withField,
} from './testing/fixtures';
import {
  CreateExpense,
  CreateSettlement,
  DeletedTransaction,
  ExpenseTransaction,
  SETTLEMENT_DESCRIPTION,
  settlementColumns,
  settlementInput,
  SettlementTransaction,
  Transaction,
  TransactionListQuery,
  TransactionPage,
  UpdateExpense,
  UpdateSettlement,
} from './transactions';

describe('CreateExpense', () => {
  it('accepts the Goa dinner', () =>
    expect(expectValid(CreateExpense, createExpense)).toEqual(createExpense));

  it('accepts optional notes and an AI request link', () => {
    expectValid(CreateExpense, { ...createExpense, notes: 'Thalassa', aiRequestId: 7 });
  });

  it('trims the description and notes', () => {
    const parsed = CreateExpense.parse({
      ...createExpense,
      description: '  Dinner ',
      notes: ' x ',
    });
    expect(parsed.description).toBe('Dinner');
    expect(parsed.notes).toBe('x');
  });

  it.each([
    [{ id: 'dinner-1' }, 'id'],
    [{ description: '   ' }, 'description'],
    [{ description: 'x'.repeat(121) }, 'description'],
    [{ amount: 0 }, 'amount'],
    [{ amount: 1200.5 }, 'amount'],
    [{ amount: MAX_AMOUNT_MINOR + 1 }, 'amount'],
    [{ amount: '120000' }, 'amount'],
    [{ currency: 'Rs' }, 'currency'],
    [{ occurredOn: '1999-12-31' }, 'occurredOn'],
    [{ occurredOn: '2026-02-29' }, 'occurredOn'],
    [{ occurredOn: '05/11/2026' }, 'occurredOn'],
    [{ notes: 'x'.repeat(1001) }, 'notes'],
    [{ payers: [] }, 'payers'],
    [{ payers: [{ userId: ids.b, amount: 0 }] }, 'payers.0.amount'],
    [
      { payers: Array.from({ length: 51 }, (_, i) => ({ userId: uuid(`f${i}`), amount: 1 })) },
      'payers',
    ],
    [{ split: { method: 'equal' } }, 'split.participants'],
    [{ aiRequestId: 0 }, 'aiRequestId'],
    [{ source: 'ai_text' }, ''],
    [{ shares: [] }, ''],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(CreateExpense, withField(createExpense, patch))).toContain(path),
  );

  it('requires every mandatory field', () => {
    for (const key of [
      'id',
      'description',
      'amount',
      'currency',
      'occurredOn',
      'payers',
      'split',
    ]) {
      const body: Record<string, unknown> = { ...createExpense };
      delete body[key];
      expect(rejectedPaths(CreateExpense, body)).toEqual([key]);
    }
  });

  it('leaves sums to core: payers that don’t add up still pass the shape check', () => {
    expectValid(CreateExpense, { ...createExpense, payers: [{ userId: ids.b, amount: 1 }] });
  });

  it('accepts a date in the future; the service applies the upper bound', () => {
    expectValid(CreateExpense, { ...createExpense, occurredOn: '2099-12-31' });
  });
});

describe('UpdateExpense', () => {
  it('is the full expense without the id', () => {
    const { id: _id, ...body } = createExpense;
    expectValid(UpdateExpense, body);
    expect(rejectedPaths(UpdateExpense, createExpense)).toEqual(['']);
  });
});

describe('CreateSettlement', () => {
  it('accepts a UPI settlement with a reference', () =>
    expect(expectValid(CreateSettlement, createSettlement)).toEqual(createSettlement));

  it('accepts every payment method', () => {
    for (const method of ['cash', 'upi', 'bank_transfer', 'other']) {
      expectValid(CreateSettlement, { ...createSettlement, method });
    }
  });

  it.each([
    [{ method: 'paypal' }, 'method'],
    [{ method: undefined }, 'method'],
    [{ amount: 0 }, 'amount'],
    [{ reference: '' }, 'reference'],
    [{ reference: 'x'.repeat(101) }, 'reference'],
    [{ note: 'x'.repeat(1001) }, 'note'],
    [{ fromUserId: 'Bilal' }, 'fromUserId'],
    [{ notes: 'wrong key' }, ''],
    [{ description: 'Paid back' }, ''],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(CreateSettlement, withField(createSettlement, patch))).toContain(path),
  );

  it('leaves "paying yourself" to core (SETTLEMENT_SAME_USER)', () => {
    expectValid(CreateSettlement, { ...createSettlement, toUserId: ids.b });
  });

  it('has an update form without the id', () => {
    const { id: _id, ...body } = createSettlement;
    expectValid(UpdateSettlement, body);
    expect(UpdateSettlement.safeParse(createSettlement).success).toBe(false);
  });
});

describe('settlement field mapping', () => {
  const { id: _id, ...body } = createSettlement;

  it('maps note → notes and reference → paymentRef, with a fixed description', () => {
    expect(settlementColumns(UpdateSettlement.parse({ ...body, note: 'Goa dues' }))).toEqual({
      description: SETTLEMENT_DESCRIPTION,
      notes: 'Goa dues',
      paymentMethod: 'upi',
      paymentRef: '431298765012',
    });
  });

  it('stores missing or blank optional fields as null', () => {
    const parsed = UpdateSettlement.parse({ ...body, note: '   ' });
    expect(settlementColumns(parsed)).toMatchObject({ notes: null, paymentRef: '431298765012' });
    const { reference: _ref, ...noRef } = parsed;
    expect(settlementColumns(noRef)).toMatchObject({ notes: null, paymentRef: null });
  });

  it('the stored description fits the description column', () => {
    expectValid(CreateExpense.shape.description, SETTLEMENT_DESCRIPTION);
  });

  it('settlementInput recreates the request body from a stored settlement', () => {
    const tx = SettlementTransaction.parse(settlementTransaction);
    expect(settlementInput(tx)).toStrictEqual(body);
    // Absent optional fields are left out rather than sent as undefined.
    expect(settlementInput({ ...tx, notes: 'Goa dues', paymentRef: null })).toStrictEqual({
      fromUserId: ids.b,
      toUserId: ids.a,
      amount: 95_000,
      currency: 'INR',
      occurredOn: '2026-11-06',
      method: 'upi',
      note: 'Goa dues',
    });
  });

  it('round-trips: request → columns → stored transaction → request', () => {
    const request = UpdateSettlement.parse({ ...body, note: 'dues' });
    const columns = settlementColumns(request);
    const tx = SettlementTransaction.parse({
      ...settlementTransaction,
      ...columns,
      payers: [{ userId: request.fromUserId, amount: request.amount }],
      shares: [{ userId: request.toUserId, amount: request.amount }],
    });
    expect(settlementInput(tx)).toEqual(request);
  });
});

describe('Transaction', () => {
  it('accepts an expense and a settlement', () => {
    expect(expectValid(Transaction, expenseTransaction).type).toBe('expense');
    expect(expectValid(Transaction, settlementTransaction).type).toBe('settlement');
  });

  it('drops fields this client doesn’t know yet', () => {
    expect(Transaction.parse({ ...expenseTransaction, category: 'Food' })).not.toHaveProperty(
      'category',
    );
  });

  it.each([
    [expenseTransaction, { paymentMethod: 'upi' }, 'paymentMethod'],
    [expenseTransaction, { splitMethod: null }, 'splitMethod'],
    [expenseTransaction, { shares: [] }, 'shares'],
    [expenseTransaction, { version: 0 }, 'version'],
    [expenseTransaction, { myNet: 0.5 }, 'myNet'],
    [settlementTransaction, { splitMethod: 'equal' }, 'splitMethod'],
    [settlementTransaction, { paymentMethod: null }, 'paymentMethod'],
    [settlementTransaction, { payers: [] }, 'payers'],
    [
      settlementTransaction,
      {
        payers: [
          { userId: ids.b, amount: 1 },
          { userId: ids.c, amount: 1 },
        ],
      },
      'payers',
    ],
    [settlementTransaction, { type: 'refund' }, 'type'],
  ])('rejects %#: a mixed-up %j', (base, patch, path) =>
    expect(rejectedPaths(Transaction, withField(base, patch))).toContain(path),
  );

  it('exports both variants separately', () => {
    expect(ExpenseTransaction.safeParse(settlementTransaction).success).toBe(false);
    expect(SettlementTransaction.safeParse(expenseTransaction).success).toBe(false);
  });

  it('pages transactions', () => {
    expectValid(TransactionPage, {
      items: [expenseTransaction, settlementTransaction],
      nextCursor: 'MjAy',
    });
  });

  it('returns the new version after a delete', () => {
    expectValid(DeletedTransaction, {
      id: ids.dinner,
      version: 2,
      deletedAt: '2026-11-06T09:00:00.000Z',
    });
  });
});

describe('TransactionListQuery', () => {
  it('parses query-string values', () => {
    expect(
      TransactionListQuery.parse({
        limit: '20',
        q: ' dinner ',
        person: ids.b,
        type: 'expense',
        from: '2026-11-01',
        to: '2026-11-30',
        includeDeleted: 'true',
      }),
    ).toEqual({
      limit: 20,
      q: 'dinner',
      person: ids.b,
      type: 'expense',
      from: '2026-11-01',
      to: '2026-11-30',
      includeDeleted: true,
    });
    expect(TransactionListQuery.parse({ includeDeleted: 'false' }).includeDeleted).toBe(false);
  });

  it('accepts a single-day range', () =>
    expectValid(TransactionListQuery, { from: '2026-11-05', to: '2026-11-05' }));

  it.each([
    [{ q: 'd' }, 'q'],
    [{ q: ' d ' }, 'q'],
    [{ includeDeleted: 'yes' }, 'includeDeleted'],
    [{ includeDeleted: '1' }, 'includeDeleted'],
    [{ type: 'refund' }, 'type'],
    [{ person: 'me' }, 'person'],
    [{ from: '2026-11-30', to: '2026-11-01' }, 'to'],
    [{ limit: '500' }, 'limit'],
    [{ sort: 'asc' }, ''],
  ])('rejects %j', (query, path) =>
    expect(rejectedPaths(TransactionListQuery, query)).toContain(path),
  );
});
