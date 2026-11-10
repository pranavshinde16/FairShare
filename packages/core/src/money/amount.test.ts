import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { assertValidAmount, isValidAmount } from './amount';
import { MAX_AMOUNT_MINOR } from './constants';

describe('isValidAmount', () => {
  it.each([1, 240_050, MAX_AMOUNT_MINOR])('accepts %d', (n) => {
    expect(isValidAmount(n)).toBe(true);
  });

  it.each([0, -1, MAX_AMOUNT_MINOR + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %d',
    (n) => {
      expect(isValidAmount(n)).toBe(false);
    },
  );
});

describe('assertValidAmount', () => {
  it('passes a valid amount', () => {
    expect(() => assertValidAmount(100)).not.toThrow();
  });

  it('names the field in the error', () => {
    const err = catchError(() => assertValidAmount(0, 'total'));
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toMatchObject({
      code: 'AMOUNT_OUT_OF_RANGE',
      details: { field: 'total', min: 1, max: MAX_AMOUNT_MINOR, actual: 0 },
    });
  });

  it('defaults the field name to "amount"', () => {
    expect(catchError(() => assertValidAmount(-5))).toMatchObject({ details: { field: 'amount' } });
  });
});

function catchError(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected an error');
}
