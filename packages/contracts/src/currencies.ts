import { z } from 'zod';
import { CurrencyCode } from './primitives';

/** A supported currency. minorUnits is its number of decimal places (INR 2, JPY 0, KWD 3). */
export const Currency = z.object({
  code: CurrencyCode,
  minorUnits: z.int().min(0).max(4),
  symbol: z.string(),
});
export type Currency = z.infer<typeof Currency>;

/** GET /api/v1/currencies: every supported currency, sorted by code. */
export const CurrencyList = z.object({ items: z.array(Currency) });
export type CurrencyList = z.infer<typeof CurrencyList>;
