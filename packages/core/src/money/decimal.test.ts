import { describe, expect, it } from 'vitest';
import { InvariantViolation } from '../errors';
import { assertFractionDigits, parseScaledDecimal, toDecimalString } from './decimal';

describe('toDecimalString', () => {
  it.each([
    [240_050, 2, '2400.50'],
    [5, 2, '0.05'],
    [-5, 2, '-0.05'],
    [0, 2, '0.00'],
    [-0, 2, '0.00'],
    [1_234, 0, '1234'],
    [1, 3, '0.001'],
    [10_000_000_000, 2, '100000000.00'],
    [-123_456, 4, '-12.3456'],
  ])('renders %d with %d decimals as %s', (amount, digits, expected) => {
    expect(toDecimalString(amount, digits)).toBe(expected);
  });

  it.each([1.5, Number.NaN, 2 ** 53])('refuses a non-safe-integer amount (%d)', (amount) => {
    expect(() => toDecimalString(amount, 2)).toThrow(InvariantViolation);
  });
});

describe('assertFractionDigits', () => {
  it.each([0, 2, 3, 4])('accepts %d', (d) => {
    expect(() => assertFractionDigits(d)).not.toThrow();
  });

  it.each([-1, 5, 1.5])('rejects %d', (d) => {
    expect(() => assertFractionDigits(d)).toThrow(InvariantViolation);
  });
});

describe('parseScaledDecimal', () => {
  it('ignores commas entirely when grouping is not allowed', () => {
    expect(parseScaledDecimal('1,000', 2, false)).toBeNull();
    expect(parseScaledDecimal('1000', 2, false)).toBe(100_000n);
  });
});
