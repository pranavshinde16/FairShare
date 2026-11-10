import { DomainError } from '../errors';
import type { Minor } from '../types';
import { BASIS_POINTS_TOTAL, MAX_AMOUNT_MINOR } from './constants';
import { assertFractionDigits, parseScaledDecimal } from './decimal';

/**
 * Parses what a user typed into minor units: parseMoney("2,400.50", 2) → 240050.
 *
 * `minorUnits` is the currency's number of decimal places (INR 2, JPY 0, KWD 3), looked up by the
 * caller. Accepts grouping commas and a partial decimal (".5", "5."); rejects signs, symbols,
 * exponents and more decimals than the currency allows. Zero is accepted (an exact split may give
 * someone nothing); whether an amount must be positive is the caller's rule.
 */
export function parseMoney(input: string, minorUnits: number): Minor {
  assertFractionDigits(minorUnits);
  const scaled = parseScaledDecimal(input, minorUnits, true);
  if (scaled === null) {
    throw new DomainError('INVALID_MONEY', 'Enter an amount like 2400 or 2,400.50.', {
      input,
      minorUnits,
    });
  }
  if (scaled > BigInt(MAX_AMOUNT_MINOR)) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', 'That amount is larger than FairShare allows.', {
      input,
      max: MAX_AMOUNT_MINOR,
    });
  }
  return Number(scaled);
}

/** parseMoney for live input: returns null instead of throwing. */
export function tryParseMoney(input: string, minorUnits: number): Minor | null {
  try {
    return parseMoney(input, minorUnits);
  } catch (err) {
    if (err instanceof DomainError) return null;
    throw err;
  }
}

/** Parses a percentage into basis points: parsePercent("33.33") → 3333. Allows 0 to 100. */
export function parsePercent(input: string): number {
  const bp = parseScaledDecimal(input, 2, false);
  if (bp === null || bp > BigInt(BASIS_POINTS_TOTAL)) {
    throw new DomainError('INVALID_PERCENT', 'Enter a percentage from 0 to 100, like 33.33.', {
      input,
    });
  }
  return Number(bp);
}
