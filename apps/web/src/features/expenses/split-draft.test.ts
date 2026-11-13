import type { Group, SplitInput } from '@fairshare/contracts';
import { computeShares } from '@fairshare/core';
import { describe, expect, it } from 'vitest';
import {
  canTakePart,
  assignRemaining,
  clampShares,
  draftFromExpense,
  emptySplit,
  evaluate,
  expenseBody,
  fillRemainder,
  newDraft,
  percentText,
  splitPaymentEvenly,
  switchMethod,
  toMultiplePayers,
  toRemember,
  toSinglePayer,
  type ExpenseDraft,
} from './split-draft';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, D] = [id(1), id(2), id(3), id(4)];
const SEED = '01933333-0000-7000-8000-000000000099';
const money = (amount: number) => `₹${(amount / 100).toFixed(2)}`;
const ctx = { seed: SEED, minorUnits: 2, money };

const draft = (patch: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  amountText: '1200',
  description: 'Dinner',
  occurredOn: '2026-11-10',
  notes: '',
  payers: { mode: 'single', userId: A },
  split: emptySplit([A, B, C]),
  ...patch,
});
const split = (patch: Partial<ExpenseDraft['split']>) => ({ ...emptySplit([A, B, C]), ...patch });

describe('evaluate: the amount and who paid', () => {
  it('splits a valid draft, and the body is what the server will be sent', () => {
    const state = evaluate(draft(), ctx);
    expect(state).toMatchObject({
      amount: 120_000,
      payers: [{ userId: A, amount: 120_000 }],
      split: { method: 'equal', participants: [A, B, C] },
      problem: null,
    });
    expect(state.shares).toEqual([
      { userId: A, amount: 40_000 },
      { userId: B, amount: 40_000 },
      { userId: C, amount: 40_000 },
    ]);
    expect(expenseBody(draft({ notes: '  tip ' }), state, 'INR')).toEqual({
      description: 'Dinner',
      amount: 120_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      notes: 'tip',
      payers: [{ userId: A, amount: 120_000 }],
      split: { method: 'equal', participants: [A, B, C] },
    });
  });

  it.each([
    ['', 'Enter the amount.'],
    ['0', 'Enter a valid amount.'],
    ['12.345', 'Enter a valid amount.'],
    ['1,00,00,00,00,000', 'Enter a valid amount.'],
  ])('asks for an amount: %j', (amountText, problem) => {
    const state = evaluate(draft({ amountText }), ctx);
    expect(state).toMatchObject({ amount: null, problem, shares: null });
    expect(expenseBody(draft({ amountText }), state, 'INR')).toBeNull();
  });

  it('wants a description before there is a body', () => {
    const d = draft({ description: '   ' });
    expect(expenseBody(d, evaluate(d, ctx), 'INR')).toBeNull();
  });

  it('several payers: what they paid must add up to the total', () => {
    const multiple = (amounts: Record<string, string>) =>
      draft({ payers: { mode: 'multiple', amounts } });
    expect(evaluate(multiple({}), ctx).problem).toBe('Choose who paid.');
    expect(evaluate(multiple({ [A]: 'abc' }), ctx).problem).toBe('Check the amounts people paid.');
    expect(evaluate(multiple({ [A]: '800', [B]: '' }), ctx)).toMatchObject({
      payersLeft: 40_000,
      payers: null,
      problem: '₹400.00 of what was paid is still to assign.',
    });
    expect(evaluate(multiple({ [A]: '800', [B]: '500' }), ctx)).toMatchObject({
      payersLeft: -10_000,
      problem: 'What people paid is ₹100.00 more than the total.',
    });
    // Someone ticked with nothing paid is left out, not sent as a 0 payer.
    expect(evaluate(multiple({ [A]: '800', [B]: '400', [C]: '0' }), ctx)).toMatchObject({
      payersLeft: 0,
      payers: [
        { userId: A, amount: 80_000 },
        { userId: B, amount: 40_000 },
      ],
      problem: null,
    });
  });
});

describe('evaluate: each split method', () => {
  it('equal: needs someone, and says nothing more', () => {
    expect(evaluate(draft({ split: split({ participants: [] }) }), ctx).problem).toBe(
      'Choose at least one person to split with.',
    );
  });

  it('exact: shows what is left or over, and saves only the people with an amount', () => {
    const exact = (values: Record<string, string>) =>
      draft({ split: split({ method: 'exact', exact: values }) });
    expect(evaluate(exact({ [A]: '500', [B]: '600' }), ctx)).toMatchObject({
      splitLeft: { amount: 10_000, unit: 'money' },
      problem: '₹100.00 left to assign.',
      split: null,
    });
    expect(evaluate(exact({ [A]: '700', [B]: '600' }), ctx)).toMatchObject({
      splitLeft: { amount: -10_000, unit: 'money' },
      problem: 'The amounts are ₹100.00 over the total.',
    });
    expect(evaluate(exact({ [A]: '5x' }), ctx).problem).toBe('Check the amounts in the split.');
    const ok = evaluate(exact({ [A]: '600', [B]: '600', [C]: '' }), ctx);
    expect(ok).toMatchObject({
      splitLeft: { amount: 0, unit: 'money' },
      problem: null,
      split: {
        method: 'exact',
        amounts: [
          { userId: A, amount: 60_000 },
          { userId: B, amount: 60_000 },
        ],
      },
    });
  });

  it('exact: has nothing to compare with until the amount is valid', () => {
    const state = evaluate(
      draft({ amountText: '', split: split({ method: 'exact', exact: { [A]: '1' } }) }),
      ctx,
    );
    expect(state).toMatchObject({ splitLeft: null, problem: 'Enter the amount.' });
  });

  it('percent: must make 100%, and shows the ₹ for each person', () => {
    const percent = (values: Record<string, string>) =>
      draft({ split: split({ method: 'percent', percent: values }) });
    expect(evaluate(percent({ [A]: '40', [B]: '50' }), ctx)).toMatchObject({
      splitLeft: { amount: 1000, unit: 'percent' },
      problem: '10% left to assign.',
    });
    expect(evaluate(percent({ [A]: '60', [B]: '50.5' }), ctx).problem).toBe(
      'The percentages add up to 110.5%, over 100%.',
    );
    expect(evaluate(percent({ [A]: '33.333' }), ctx).problem).toBe('Enter percentages like 33.33.');
    expect(evaluate(percent({ [A]: '101' }), ctx).problem).toBe('Enter percentages like 33.33.');
    const ok = evaluate(percent({ [A]: '33.33', [B]: '33.33', [C]: '33.34' }), ctx);
    expect(ok.problem).toBeNull();
    expect(ok.split).toEqual({
      method: 'percent',
      basisPoints: [
        { userId: A, bp: 3333 },
        { userId: B, bp: 3333 },
        { userId: C, bp: 3334 },
      ],
    });
    expect(ok.shares!.reduce((s, l) => s + l.amount, 0)).toBe(120_000);
  });

  it('shares: someone must have one; 0 leaves a person out', () => {
    const shares = (values: Record<string, number>) =>
      draft({ split: split({ method: 'shares', shares: values }) });
    expect(evaluate(shares({ [A]: 0, [B]: 0 }), ctx).problem).toBe(
      'Give at least one person a share.',
    );
    const ok = evaluate(shares({ [A]: 2, [B]: 1, [C]: 0 }), ctx);
    expect(ok.split).toEqual({
      method: 'shares',
      shares: [
        { userId: A, shares: 2 },
        { userId: B, shares: 1 },
      ],
    });
    expect(ok.shares).toEqual([
      { userId: A, amount: 80_000 },
      { userId: B, amount: 40_000 },
    ]);
  });

  it('shows exactly what the server will compute (same seed)', () => {
    // ₹100 three ways: who gets the extra paisa depends on the expense's ID.
    for (const seed of [SEED, id(77), id(78)]) {
      const d = draft({ amountText: '100' });
      const state = evaluate(d, { ...ctx, seed });
      expect(state.shares).toEqual(computeShares(10_000, state.split!, seed));
    }
  });
});

describe('round trips (Blueprint 7.3 “Edit mode”)', () => {
  const base = { amount: 120_000, description: 'Dinner', occurredOn: '2026-11-10', notes: null };
  it.each([
    ['equal', { method: 'equal', participants: [A, C] }],
    [
      'exact',
      {
        method: 'exact',
        amounts: [
          { userId: A, amount: 70_050 },
          { userId: B, amount: 49_950 },
        ],
      },
    ],
    [
      'percent',
      {
        method: 'percent',
        basisPoints: [
          { userId: A, bp: 3333 },
          { userId: B, bp: 6667 },
        ],
      },
    ],
    [
      'shares',
      {
        method: 'shares',
        shares: [
          { userId: A, shares: 3 },
          { userId: B, shares: 1 },
        ],
      },
    ],
  ] as [string, SplitInput][])('%s reopens as entered and saves the same split', (_, input) => {
    const payers = [
      { userId: A, amount: 100_000 },
      { userId: D, amount: 20_000 },
    ];
    const d = draftFromExpense({ ...base, payers, split: input }, 2);
    const state = evaluate(d, ctx);
    const body = expenseBody(d, state, 'INR')!;
    expect(body.split).toEqual(input);
    expect(body.payers).toEqual(payers);
    expect(body.amount).toBe(120_000);
  });

  it('an expense saved without its split input reopens as exact amounts', () => {
    const d = draftFromExpense(
      {
        ...base,
        payers: [{ userId: A, amount: 120_000 }],
        split: null,
        shares: [
          { userId: A, amount: 20_000 },
          { userId: B, amount: 100_000 },
        ],
      },
      2,
    );
    expect(d.split.method).toBe('exact');
    expect(d.split.exact).toEqual({ [A]: '200.00', [B]: '1000.00' });
    expect(d.payers).toEqual({ mode: 'single', userId: A });
  });

  it('writes percentages as people type them', () => {
    expect([3333, 1250, 5000, 5, 10_000, 0].map(percentText)).toEqual([
      '33.33',
      '12.5',
      '50',
      '0.05',
      '100',
      '0',
    ]);
  });
});

describe('shortcuts', () => {
  it('switching method starts from the current split', () => {
    const state = evaluate(draft({ amountText: '100' }), ctx);
    const exact = switchMethod(draft().split, 'exact', {
      shares: state.shares,
      seed: SEED,
      minorUnits: 2,
    });
    expect(Object.values(exact.exact).sort()).toEqual(['33.33', '33.33', '33.34']);
    const percent = switchMethod(draft().split, 'percent', {
      shares: state.shares,
      seed: SEED,
      minorUnits: 2,
    });
    expect(Object.values(percent.percent).sort()).toEqual(['33.33', '33.33', '33.34']);
    const shares = switchMethod(draft().split, 'shares', {
      shares: state.shares,
      seed: SEED,
      minorUnits: 2,
    });
    expect(shares.shares).toEqual({ [A]: 1, [B]: 1, [C]: 1 });
    // Each starts the split whole.
    for (const s of [exact, percent, shares]) {
      expect(evaluate(draft({ amountText: '100', split: s }), ctx).problem).toBeNull();
    }
  });

  it('switching back keeps what was typed', () => {
    const typed = split({ method: 'exact', exact: { [A]: '1' } });
    const away = switchMethod(typed, 'equal', { shares: null, seed: SEED, minorUnits: 2 });
    expect(switchMethod(away, 'exact', { shares: null, seed: SEED, minorUnits: 2 }).exact).toEqual({
      [A]: '1',
    });
    // An equal split with nobody picks up whoever was in.
    const nobody = split({ participants: [], method: 'shares', shares: { [B]: 2 } });
    const shares = [{ userId: B, amount: 1 }];
    expect(
      switchMethod(nobody, 'equal', { shares, seed: SEED, minorUnits: 2 }).participants,
    ).toEqual([B]);
  });

  it('assigns what is left, and won’t go below zero', () => {
    const s = split({ method: 'exact', exact: { [A]: '500', [B]: '600' } });
    expect(assignRemaining(s, B, 10_000, 2)!.exact[B]).toBe('700.00');
    expect(assignRemaining(s, C, 10_000, 2)!.exact[C]).toBe('100.00');
    expect(assignRemaining(s, A, -60_000, 2)).toBeNull();
    expect(assignRemaining(split({ method: 'exact', exact: { [A]: 'x' } }), A, 1, 2)).toBeNull();
  });

  it('fills the remaining percentage', () => {
    const s = split({ method: 'percent', percent: { [A]: '40', [B]: '50' } });
    expect(fillRemainder(s, C, 1000)!.percent[C]).toBe('10');
    expect(fillRemainder(s, B, -6000)).toBeNull();
    expect(fillRemainder(split({ method: 'percent', percent: { [A]: 'x' } }), A, 1)).toBeNull();
  });

  it('splits the payment equally between who paid, with its own seed', () => {
    const payers = { mode: 'multiple' as const, amounts: { [A]: '', [B]: '1', [C]: '' } };
    const even = splitPaymentEvenly(payers, 10_000, SEED, 2);
    expect(even.mode === 'multiple' && Object.values(even.amounts).sort()).toEqual([
      '33.33',
      '33.33',
      '33.34',
    ]);
    expect(evaluate(draft({ amountText: '100', payers: even }), ctx).problem).toBeNull();
    // 2 paise between 3: someone pays nothing.
    const tiny = splitPaymentEvenly(payers, 2, SEED, 2);
    expect(tiny.mode === 'multiple' && Object.values(tiny.amounts).sort()).toEqual([
      '0.00',
      '0.01',
      '0.01',
    ]);
  });

  it('moves between one payer and several', () => {
    expect(toMultiplePayers({ mode: 'single', userId: A }, 120_000, 2)).toEqual({
      mode: 'multiple',
      amounts: { [A]: '1200.00' },
    });
    expect(toMultiplePayers({ mode: 'single', userId: A }, null, 2)).toEqual({
      mode: 'multiple',
      amounts: { [A]: '' },
    });
    const several = { mode: 'multiple' as const, amounts: { [A]: '200', [B]: '1000', [C]: 'x' } };
    expect(toMultiplePayers(several, 1, 2)).toBe(several);
    expect(toSinglePayer(several, D, 2)).toEqual({ mode: 'single', userId: B });
    expect(toSinglePayer({ mode: 'multiple', amounts: {} }, D, 2)).toEqual({
      mode: 'single',
      userId: D,
    });
    expect(toSinglePayer({ mode: 'single', userId: C }, D, 2)).toEqual({
      mode: 'single',
      userId: C,
    });
  });

  it('keeps share counts whole and in range', () => {
    expect([-1, 0, 2.7, 1001, Number.NaN].map(clampShares)).toEqual([0, 0, 2, 1000, 0]);
  });
});

describe('remembered defaults (Blueprint 7.3 “Smart defaults”)', () => {
  const member = (userId: string, left = false) => ({
    user: { id: userId, name: userId, avatarUrl: null, isPlaceholder: false, isDeleted: false },
    role: 'member' as const,
    joinedAt: '2026-11-01T00:00:00.000Z',
    leftAt: left ? '2026-11-02T00:00:00.000Z' : null,
  });
  const group = {
    id: id(9),
    members: [member(A), member(B), member(C), member(D, true)],
  } as unknown as Group;

  it('starts with the remembered payer and participants, if they’re still in the group', () => {
    expect(newDraft(group, A, { payerId: B, participants: [A, B] }, '2026-11-13')).toMatchObject({
      occurredOn: '2026-11-13',
      payers: { mode: 'single', userId: B },
      split: { method: 'equal', participants: [A, B] },
    });
    // Dev left: not the payer, not in the split. Nobody left: everyone.
    expect(newDraft(group, A, { payerId: D, participants: [D] }, '2026-11-13')).toMatchObject({
      payers: { userId: A },
      split: { participants: [A, B, C] },
    });
  });

  it('leaves a deleted account out of a new expense, even when remembered', () => {
    // Deleted, but still in the group because something is owed: settle-able, not split-able.
    const gone = { ...member(C), user: { ...member(C).user, isDeleted: true } };
    const withGone = { ...group, members: [member(A), member(B), gone] } as unknown as Group;
    expect(newDraft(withGone, A, { payerId: C, participants: [A, C] }, '2026-11-13')).toMatchObject(
      { payers: { userId: A }, split: { participants: [A] } },
    );
    expect(newDraft(withGone, A, {}, '2026-11-13').split.participants).toEqual([A, B]);
    expect(canTakePart(gone)).toBe(false);
    expect(canTakePart(member(A))).toBe(true);
    expect(canTakePart(member(D, true))).toBe(false);
  });

  it('remembers one payer and an equal split only', () => {
    expect(toRemember(draft())).toEqual({ payerId: A, participants: [A, B, C] });
    expect(
      toRemember(
        draft({
          payers: { mode: 'multiple', amounts: { [A]: '1' } },
          split: split({ method: 'shares' }),
        }),
      ),
    ).toEqual({});
  });
});
