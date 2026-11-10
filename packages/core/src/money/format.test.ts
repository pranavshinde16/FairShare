import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it('formats rupees with the symbol and Indian grouping', () => {
    expect(formatMoney(24_005_050, 2, Intl, { locale: 'en-IN', currency: 'INR' })).toBe(
      '₹2,40,050.50',
    );
  });

  it('formats negative balances', () => {
    expect(formatMoney(-240_050, 2, Intl, { locale: 'en-IN', currency: 'INR' })).toBe('-₹2,400.50');
  });

  it('formats digits only when no currency is given', () => {
    expect(formatMoney(100_000_000, 2, Intl, { locale: 'en-US' })).toBe('1,000,000.00');
  });

  it('respects zero-decimal currencies', () => {
    expect(formatMoney(1_500, 0, Intl, { locale: 'en-US', currency: 'JPY' })).toBe('¥1,500');
  });

  it('respects three-decimal currencies', () => {
    expect(formatMoney(1_234, 3, Intl, { locale: 'en-US' })).toBe('1.234');
  });

  it('hands Intl an exact decimal string, never a float', () => {
    const seen: unknown[] = [];
    class RecordingFormat {
      format(value: string) {
        seen.push(value);
        return 'formatted';
      }
    }
    formatMoney(10_000_000_000, 2, { NumberFormat: RecordingFormat }, { locale: 'en-IN' });
    expect(seen).toEqual(['100000000.00']);
  });
});
