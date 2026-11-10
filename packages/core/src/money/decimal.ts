// String-based decimal handling. Money never passes through parseFloat or float arithmetic.

import { InvariantViolation } from '../errors';

/** 2,400.50 · 240,000 */
const WESTERN_GROUPING = /^\d{1,3}(,\d{3})+$/;
/** 2,40,000 · 12,34,56,789 */
const INDIAN_GROUPING = /^\d{1,2}(,\d{2})*,\d{3}$/;
const DIGITS = /^\d*$/;

/**
 * Parses a non-negative decimal string into an integer scaled by 10^fractionDigits, e.g.
 * ("2,400.50", 2) → 240050n. Returns null for anything that isn't a plain decimal number:
 * signs, exponents, letters, misplaced separators, or more fraction digits than allowed.
 *
 * Grouping commas must sit in Western or Indian positions, so "2,50" (a European-style decimal
 * comma) is rejected rather than silently read as 250.
 */
export function parseScaledDecimal(
  raw: string,
  fractionDigits: number,
  allowGrouping: boolean,
): bigint | null {
  const input = raw.trim();
  const dot = input.indexOf('.');
  let integerPart = dot === -1 ? input : input.slice(0, dot);
  const fractionPart = dot === -1 ? '' : input.slice(dot + 1);

  if (allowGrouping && integerPart.includes(',')) {
    if (!WESTERN_GROUPING.test(integerPart) && !INDIAN_GROUPING.test(integerPart)) return null;
    integerPart = integerPart.replaceAll(',', '');
  }
  if (!DIGITS.test(integerPart) || !DIGITS.test(fractionPart)) return null;
  if (integerPart === '' && fractionPart === '') return null;
  if (fractionPart.length > fractionDigits) return null;

  return BigInt((integerPart || '0') + fractionPart.padEnd(fractionDigits, '0'));
}

/** Renders minor units as a plain decimal string: (240050, 2) → "2400.50", (-5, 2) → "-0.05". */
export function toDecimalString(amount: number, fractionDigits: number): string {
  assertFractionDigits(fractionDigits);
  if (!Number.isSafeInteger(amount)) {
    throw new InvariantViolation('Amount must be a safe integer.', { amount });
  }
  const sign = amount < 0 ? '-' : '';
  const digits = String(Math.abs(amount)).padStart(fractionDigits + 1, '0');
  const cut = digits.length - fractionDigits;
  const fraction = fractionDigits > 0 ? `.${digits.slice(cut)}` : '';
  return `${sign}${digits.slice(0, cut)}${fraction}`;
}

/** ISO 4217 currencies use 0 to 4 minor-unit digits (JPY 0, INR 2, KWD 3, CLF 4). */
export function assertFractionDigits(fractionDigits: number): void {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) {
    throw new InvariantViolation('Minor units must be an integer from 0 to 4.', { fractionDigits });
  }
}
