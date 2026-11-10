import { describe, expect, it } from 'vitest';
import { DomainError, InvariantViolation } from '../errors';
import { MAX_AMOUNT_MINOR } from './constants';
import { parseMoney, parsePercent, tryParseMoney } from './parse';

const INR = 2;
const JPY = 0;
const KWD = 3;

describe('parseMoney', () => {
  it.each([
    ['2400', INR, 240_000],
    ['2,400.50', INR, 240_050],
    ['2,40,000', INR, 24_000_000],
    ['240,000', INR, 24_000_000],
    ['1,23,45,678.90', INR, 1_234_567_890],
    ['9,99,99,999.99', INR, 9_999_999_999],
    ['1,000', INR, 100_000],
    ['.5', INR, 50],
    ['5.', INR, 500],
    ['  2400\t', INR, 240_000],
    ['0', INR, 0],
    ['0.01', INR, 1],
    ['007', INR, 700],
    ['1500', JPY, 1_500],
    ['1,500', JPY, 1_500],
    ['1.234', KWD, 1_234],
    ['100000000', INR, MAX_AMOUNT_MINOR],
  ])('parses %j (%d decimals) as %d', (input, minorUnits, expected) => {
    expect(parseMoney(input, minorUnits)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['.', 'a lone decimal point'],
    ['-5', 'a negative sign'],
    ['+5', 'a plus sign'],
    ['1e3', 'an exponent'],
    ['abc', 'letters'],
    ['₹2400', 'a currency symbol'],
    ['2,50', 'a European decimal comma'],
    ['1,00', 'misplaced grouping'],
    [',100', 'a leading comma'],
    ['1,000,00', 'mixed grouping'],
    ['2 400', 'an inner space'],
    ['1.234', 'too many decimals for INR'],
    ['1.2.3', 'two decimal points'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['0x10', 'hex'],
    ['١٢', 'non-ASCII digits'],
  ])('rejects %j (%s) with INVALID_MONEY', (input) => {
    expect(() => parseMoney(input, INR)).toThrow(
      expect.objectContaining({ code: 'INVALID_MONEY' }) as Error,
    );
  });

  it('rejects decimals in a currency that has none (JPY)', () => {
    expect(() => parseMoney('1.5', JPY)).toThrow(DomainError);
  });

  it('rejects a fourth decimal in a three-decimal currency (KWD)', () => {
    expect(() => parseMoney('1.2345', KWD)).toThrow(DomainError);
  });

  it('rejects amounts above the cap with AMOUNT_OUT_OF_RANGE', () => {
    expect(() => parseMoney('100000000.01', INR)).toThrow(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }) as Error,
    );
  });

  it('rejects huge inputs without losing precision on the way', () => {
    expect(() => parseMoney('99999999999999999999999', INR)).toThrow(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }) as Error,
    );
  });

  it('treats an invalid currency definition as a bug', () => {
    expect(() => parseMoney('1', 7)).toThrow(InvariantViolation);
  });
});

describe('tryParseMoney', () => {
  it('returns the amount for valid input', () => {
    expect(tryParseMoney('2,400', INR)).toBe(240_000);
  });

  it('returns null for invalid or out-of-range input', () => {
    expect(tryParseMoney('abc', INR)).toBeNull();
    expect(tryParseMoney('999999999', INR)).toBeNull();
  });

  it('still throws for bugs, not user input', () => {
    expect(() => tryParseMoney('1', -1)).toThrow(InvariantViolation);
  });
});

describe('parsePercent', () => {
  it.each([
    ['33.33', 3_333],
    ['33.34', 3_334],
    ['100', 10_000],
    ['0', 0],
    ['50.5', 5_050],
    ['.5', 50],
    [' 60 ', 6_000],
  ])('parses %j as %d basis points', (input, expected) => {
    expect(parsePercent(input)).toBe(expected);
  });

  it.each(['100.01', '33.333', '-1', '1,000', 'abc', '', '50%'])('rejects %j', (input) => {
    expect(() => parsePercent(input)).toThrow(
      expect.objectContaining({ code: 'INVALID_PERCENT' }) as Error,
    );
  });
});
