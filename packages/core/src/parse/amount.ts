import { MAX_AMOUNT_MINOR } from '../money/constants';
import { parseScaledDecimal } from '../money/decimal';
import type { Minor } from '../types';

/** Currency marks and words around an amount as people (and models) write it. */
const MARKS = /^(?:₹|rs\.?|inr|rupees?)\s*|\s*(?:₹|rs\.?|inr|rupees?|\/-)$/i;

/**
 * An amount written as text, in minor units: "2400", "2,400.50", "₹2,40,000", "Rs. 450/-", "2.4k".
 * Null for anything else, including zero, negatives and amounts over the cap. Every amount a model
 * returns goes through this (or parseMoney): its numbers are never trusted as numbers.
 */
export function readAmount(text: string, minorUnits: number): Minor | null {
  let rest = text.trim();
  for (let i = 0; i < 2; i++) rest = rest.replace(MARKS, '').trim();
  // "2.4k": three more decimal places is the same as multiplying by 1,000.
  const thousands = /k$/i.test(rest);
  if (thousands) rest = rest.slice(0, -1).trim();
  const scaled = parseScaledDecimal(rest, minorUnits + (thousands ? 3 : 0), true);
  if (scaled === null || scaled === 0n || scaled > BigInt(MAX_AMOUNT_MINOR)) return null;
  return Number(scaled);
}
