import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT_MINOR } from '../money/constants';
import { readAmount } from './amount';

describe('readAmount', () => {
  it.each([
    ['2400', 240_000],
    ['2,400.50', 240_050],
    ['₹2,40,000', 24_000_000],
    ['₹ 450', 45_000],
    ['Rs. 450/-', 45_000],
    ['rs 450', 45_000],
    ['INR 2400', 240_000],
    ['2400 rupees', 240_000],
    ['2.4k', 240_000],
    ['2.45K', 245_000],
    ['.5', 50],
  ])('reads %j', (text, expected) => expect(readAmount(text, 2)).toBe(expected));

  it.each(['', '0', '0.00', '-5', 'abc', '1e3', '2,50', '12.345', '$20', 'Rs.'])(
    'refuses %j',
    (text) => expect(readAmount(text, 2)).toBeNull(),
  );

  it('respects the currency’s decimals', () => {
    expect(readAmount('2400', 0)).toBe(2400);
    expect(readAmount('2400.5', 0)).toBeNull();
    expect(readAmount('1.5k', 0)).toBe(1500);
  });

  it('refuses amounts over the cap', () => {
    expect(readAmount(String(MAX_AMOUNT_MINOR / 100), 2)).toBe(MAX_AMOUNT_MINOR);
    expect(readAmount(String(MAX_AMOUNT_MINOR / 100 + 1), 2)).toBeNull();
  });

  it('never throws, and returns a positive safe integer or null', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (text) => {
        const value = readAmount(text, 2);
        expect(value === null || (Number.isSafeInteger(value) && value > 0)).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });
});
