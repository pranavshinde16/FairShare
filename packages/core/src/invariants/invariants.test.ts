import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import type { LedgerTransaction } from '../ledger/types';
import { dinner, fuel, settlement } from '../testing/goa';
import { invariant } from './invariant';
import { assertNetsSumToZero, assertTransactionInvariants } from './transaction';

const line = (userId: string, amount: number) => ({ userId, amount });

describe('invariant', () => {
  it('does nothing when the condition holds', () => {
    expect(() => invariant(true, 'fine')).not.toThrow();
  });

  it('throws InvariantViolation with details otherwise', () => {
    expect(() => invariant(false, 'broken', { id: 1 })).toThrow(
      expect.objectContaining({
        name: 'InvariantViolation',
        message: 'broken',
        details: { id: 1 },
      }) as Error,
    );
  });
});

describe('assertTransactionInvariants', () => {
  it.each([
    ['an expense', dinner],
    ['a multi-payer expense', fuel],
    ['a settlement', settlement],
  ])('accepts %s', (_, tx) => {
    expect(() => assertTransactionInvariants(tx)).not.toThrow();
  });

  const broken: [string, Partial<LedgerTransaction>][] = [
    ['a zero amount', { amount: 0 }],
    ['no payers', { payers: [] }],
    ['no shares', { shares: [] }],
    ['a payer listed twice', { payers: [line('b', 60_000), line('b', 60_000)] }],
    ['a zero share', { shares: [line('a', 120_000), line('b', 0)] }],
    ['payers that do not sum (I1)', { payers: [line('b', 110_000)] }],
    ['shares that do not sum (I2)', { shares: [line('a', 60_000), line('b', 50_000)] }],
  ];
  it.each(broken)('rejects %s', (_, change) => {
    expect(() => assertTransactionInvariants({ ...dinner, ...change })).toThrow(InvariantViolation);
  });

  it('rejects a settlement with two recipients (I9)', () => {
    const tx = { ...settlement, shares: [line('a', 50_000), line('c', 45_000)] };
    expect(() => assertTransactionInvariants(tx)).toThrow(/exactly one payer/);
  });

  it('rejects a settlement with two payers (I9)', () => {
    const tx = { ...settlement, payers: [line('b', 50_000), line('c', 45_000)] };
    expect(() => assertTransactionInvariants(tx)).toThrow(/exactly one payer/);
  });

  it('rejects a settlement to yourself (I9)', () => {
    const tx = { ...settlement, payers: [line('a', 95_000)], shares: [line('a', 95_000)] };
    expect(() => assertTransactionInvariants(tx)).toThrow(/two different people/);
  });
});

describe('assertNetsSumToZero', () => {
  it('accepts nets that cancel out, and an empty group', () => {
    expect(() => assertNetsSumToZero([line('a', 5), line('b', -5)])).not.toThrow();
    expect(() => assertNetsSumToZero([])).not.toThrow();
  });

  it('rejects nets that do not cancel out, with context', () => {
    expect(() => assertNetsSumToZero([line('a', 5)], { groupId: 'g' })).toThrow(
      expect.objectContaining({ details: { groupId: 'g', sum: 5 } }) as Error,
    );
  });

  it('rejects a non-integer net', () => {
    expect(() => assertNetsSumToZero([line('a', 0.1), line('b', -0.1)])).toThrow(
      InvariantViolation,
    );
  });
});
