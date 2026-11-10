// Property-based tests for money parsing and formatting (plan §10.3), 1,000 random cases each.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RUNS } from '../testing/arbitraries';
import { MAX_AMOUNT_MINOR } from './constants';
import { toDecimalString } from './decimal';
import { formatMoney } from './format';
import { parseMoney } from './parse';

const amountArb = fc.oneof(
  fc.integer({ min: 0, max: 100_000 }),
  fc.integer({ min: 0, max: MAX_AMOUNT_MINOR }),
);
const minorUnitsArb = fc.integer({ min: 0, max: 3 });

describe('money properties', () => {
  it('parseMoney ∘ formatMoney returns the original amount (Indian and Western grouping)', () => {
    fc.assert(
      fc.property(
        amountArb,
        minorUnitsArb,
        fc.constantFrom('en-IN', 'en-US'),
        (amount, minorUnits, locale) => {
          expect(parseMoney(formatMoney(amount, minorUnits, Intl, { locale }), minorUnits)).toBe(
            amount,
          );
        },
      ),
      RUNS,
    );
  });

  it('parseMoney ∘ toDecimalString returns the original amount', () => {
    fc.assert(
      fc.property(amountArb, fc.integer({ min: 0, max: 4 }), (amount, minorUnits) => {
        expect(parseMoney(toDecimalString(amount, minorUnits), minorUnits)).toBe(amount);
      }),
      RUNS,
    );
  });

  it('parseMoney never returns a fractional or unsafe number for any input string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), minorUnitsArb, (input, minorUnits) => {
        try {
          const value = parseMoney(input, minorUnits);
          expect(Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR).toBe(true);
        } catch (err) {
          expect((err as { name: string }).name).toBe('DomainError');
        }
      }),
      RUNS,
    );
  });
});
