import { describe, expect, it } from 'vitest';
import { BASIS_POINTS_TOTAL, MAX_AMOUNT_MINOR } from './constants';

describe('money constants', () => {
  it('keeps amount × largest weight inside the safe-integer range', () => {
    expect(MAX_AMOUNT_MINOR * BASIS_POINTS_TOTAL).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('caps a single transaction at ₹10 crore in paise', () => {
    expect(MAX_AMOUNT_MINOR).toBe(10_000_000_000);
  });
});
