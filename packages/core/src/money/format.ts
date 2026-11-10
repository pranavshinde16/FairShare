import type { Minor } from '../types';
import { toDecimalString } from './decimal';

/** The slice of Intl that formatting needs. The global `Intl` satisfies it. */
export type IntlLike = {
  NumberFormat: new (
    locale: string,
    options: Intl.NumberFormatOptions,
  ) => { format(value: Intl.StringNumericLiteral): string };
};

export type FormatMoneyOptions = {
  locale: string;
  /** ISO code. When given, the currency symbol is shown (₹2,400.50); otherwise digits only. */
  currency?: string;
};

/**
 * Display helper. `intl` is passed in (normally the global Intl) so core stays free of ambient
 * environment access and tests can pin formatting behavior.
 *
 * The amount reaches Intl as an exact decimal string, never as a float division result.
 */
export function formatMoney(
  amount: Minor,
  minorUnits: number,
  intl: IntlLike,
  options: FormatMoneyOptions,
): string {
  const formatter = new intl.NumberFormat(options.locale, {
    ...(options.currency === undefined ? {} : { style: 'currency', currency: options.currency }),
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  });
  return formatter.format(toDecimalString(amount, minorUnits) as Intl.StringNumericLiteral);
}
