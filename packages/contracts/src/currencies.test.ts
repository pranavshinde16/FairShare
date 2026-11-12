import { describe, expect, it } from 'vitest';
import { Currency, CurrencyList } from './currencies';

describe('Currency', () => {
  it('accepts 0 to 4 decimal places', () => {
    for (const minorUnits of [0, 2, 3, 4]) {
      expect(Currency.safeParse({ code: 'KWD', minorUnits, symbol: 'KD' }).success).toBe(true);
    }
  });

  it('rejects a malformed code or an impossible number of decimals', () => {
    expect(Currency.safeParse({ code: 'inr', minorUnits: 2, symbol: '₹' }).success).toBe(false);
    expect(Currency.safeParse({ code: 'INR', minorUnits: 5, symbol: '₹' }).success).toBe(false);
    expect(Currency.safeParse({ code: 'INR', minorUnits: 1.5, symbol: '₹' }).success).toBe(false);
  });
});

describe('CurrencyList', () => {
  it('wraps the currencies in items', () => {
    const inr = { code: 'INR', minorUnits: 2, symbol: '₹' };
    expect(CurrencyList.parse({ items: [inr] })).toEqual({ items: [inr] });
  });
});
