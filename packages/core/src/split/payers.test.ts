import { describe, expect, it } from 'vitest';
import { allocateProportional } from './allocate';
import { splitPaymentEqually, validatePayers } from './payers';

const code = (c: string) => expect.objectContaining({ code: c }) as Error;

describe('validatePayers', () => {
  it('accepts multiple payers that sum to the total and sorts them', () => {
    expect(
      validatePayers(300_000, [
        { userId: 'd', amount: 100_000 },
        { userId: 'c', amount: 200_000 },
      ]),
    ).toEqual([
      { userId: 'c', amount: 200_000 },
      { userId: 'd', amount: 100_000 },
    ]);
  });

  it('needs at least one payer', () => {
    expect(() => validatePayers(100, [])).toThrow(code('NO_PARTICIPANTS'));
  });

  it('rejects the same payer twice', () => {
    expect(() =>
      validatePayers(100, [
        { userId: 'a', amount: 50 },
        { userId: 'a', amount: 50 },
      ]),
    ).toThrow(code('DUPLICATE_USER'));
  });

  it.each([0, -5, 2.5])('rejects a payer amount of %d', (amount) => {
    expect(() => validatePayers(100, [{ userId: 'a', amount }])).toThrow(
      code('AMOUNT_OUT_OF_RANGE'),
    );
  });

  it('reports PAYER_SUM_MISMATCH with the expected and actual sums', () => {
    expect(() =>
      validatePayers(300_000, [
        { userId: 'c', amount: 200_000 },
        { userId: 'd', amount: 50_000 },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'PAYER_SUM_MISMATCH',
        details: { expected: 300_000, actual: 250_000 },
      }) as Error,
    );
  });

  it('rejects an invalid total', () => {
    expect(() => validatePayers(0, [{ userId: 'a', amount: 1 }])).toThrow(
      code('AMOUNT_OUT_OF_RANGE'),
    );
  });
});

describe('splitPaymentEqually', () => {
  it('divides a bill between two payers', () => {
    expect(splitPaymentEqually(300_000, ['d', 'c'], 'tx')).toEqual([
      { userId: 'c', amount: 150_000 },
      { userId: 'd', amount: 150_000 },
    ]);
  });

  it('uses its own seed, independent of the share split', () => {
    expect(splitPaymentEqually(100, ['a', 'b', 'c'], 'tx')).toEqual(
      allocateProportional(
        100,
        [
          { userId: 'a', weight: 1 },
          { userId: 'b', weight: 1 },
          { userId: 'c', weight: 1 },
        ],
        'tx:payers',
      ),
    );
  });

  it('leaves out payers whose part rounds to zero, so every payer amount stays positive', () => {
    expect(splitPaymentEqually(1, ['a', 'b'], 'tx')).toHaveLength(1);
  });

  it('rejects an invalid total', () => {
    expect(() => splitPaymentEqually(0, ['a'], 'tx')).toThrow(code('AMOUNT_OUT_OF_RANGE'));
  });
});
