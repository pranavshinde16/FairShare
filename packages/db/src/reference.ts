import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { currencies } from './schema';

/**
 * Supported currencies (ISO 4217). minorUnits is the number of decimal places, matching Intl
 * (CLDR) so formatting and input agree; core receives it as an argument. Applied by runMigrations,
 * so every environment, production included, has them.
 *
 * Never change a currency's minorUnits once amounts exist in it: every stored amount would change
 * meaning. Adding currencies is always safe.
 */
export const CURRENCIES: { code: string; minorUnits: number; symbol: string }[] = [
  { code: 'INR', minorUnits: 2, symbol: '₹' },
  { code: 'USD', minorUnits: 2, symbol: '$' },
  { code: 'EUR', minorUnits: 2, symbol: '€' },
  { code: 'GBP', minorUnits: 2, symbol: '£' },
  { code: 'AED', minorUnits: 2, symbol: 'AED' },
  { code: 'SAR', minorUnits: 2, symbol: 'SAR' },
  { code: 'QAR', minorUnits: 2, symbol: 'QAR' },
  { code: 'KWD', minorUnits: 3, symbol: 'KD' },
  { code: 'BHD', minorUnits: 3, symbol: 'BD' },
  { code: 'OMR', minorUnits: 3, symbol: 'OMR' },
  { code: 'SGD', minorUnits: 2, symbol: 'S$' },
  { code: 'MYR', minorUnits: 2, symbol: 'RM' },
  { code: 'THB', minorUnits: 2, symbol: '฿' },
  // ISO 4217 says 2, but sen are obsolete and CLDR/Intl formats rupiah with 0 decimals.
  { code: 'IDR', minorUnits: 0, symbol: 'Rp' },
  { code: 'PHP', minorUnits: 2, symbol: '₱' },
  { code: 'VND', minorUnits: 0, symbol: '₫' },
  { code: 'JPY', minorUnits: 0, symbol: '¥' },
  { code: 'KRW', minorUnits: 0, symbol: '₩' },
  { code: 'CNY', minorUnits: 2, symbol: 'CN¥' },
  { code: 'HKD', minorUnits: 2, symbol: 'HK$' },
  { code: 'LKR', minorUnits: 2, symbol: 'Rs' },
  { code: 'NPR', minorUnits: 2, symbol: 'Rs' },
  { code: 'BDT', minorUnits: 2, symbol: '৳' },
  { code: 'AUD', minorUnits: 2, symbol: 'A$' },
  { code: 'NZD', minorUnits: 2, symbol: 'NZ$' },
  { code: 'CAD', minorUnits: 2, symbol: 'CA$' },
  { code: 'CHF', minorUnits: 2, symbol: 'CHF' },
  { code: 'SEK', minorUnits: 2, symbol: 'kr' },
  { code: 'NOK', minorUnits: 2, symbol: 'kr' },
  { code: 'DKK', minorUnits: 2, symbol: 'kr' },
  { code: 'ZAR', minorUnits: 2, symbol: 'R' },
  { code: 'BRL', minorUnits: 2, symbol: 'R$' },
  { code: 'MXN', minorUnits: 2, symbol: 'MX$' },
  { code: 'TRY', minorUnits: 2, symbol: '₺' },
];

/** Upserts CURRENCIES. Safe to run any number of times; never removes a currency. */
export async function applyReferenceData(db: Db): Promise<void> {
  await db
    .insert(currencies)
    .values(CURRENCIES)
    .onConflictDoUpdate({
      target: currencies.code,
      set: { minorUnits: sql`excluded.minor_units`, symbol: sql`excluded.symbol` },
    });
}
