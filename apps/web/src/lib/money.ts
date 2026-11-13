import { formatMoney } from '@fairshare/core';
import type { Money } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { currenciesQuery } from '../features/profile/queries';

/**
 * The one money formatter (DESIGN_SPEC §3): Indian digit grouping, and each currency's own decimals
 * (two for rupees): 28417 → "₹28,417.00", 128417 → "₹1,28,417.00". A group in another currency
 * keeps its own symbol ("$1,28,417.50"). Amounts are integer minor units, handed to Intl as an
 * exact decimal string by core, never as a float.
 */
export const MONEY_LOCALE = 'en-IN';

/** Minor units for a currency when the list hasn't loaded (every common currency has 2). */
const DEFAULT_MINOR_UNITS = 2;

export function formatAmount(amount: number, currency: string, minorUnits: number): string {
  return formatMoney(amount, minorUnits, Intl, { locale: MONEY_LOCALE, currency });
}

/**
 * The compact per-person tiles under "Paid by you and split equally" only (§3's one exception):
 * whole units, "₹750". Rounded to the nearest unit; every other amount shows its decimals.
 */
export function formatWholeAmount(amount: number, currency: string, minorUnits: number): string {
  return formatMoney(Math.round(amount / 10 ** minorUnits), 0, Intl, {
    locale: MONEY_LOCALE,
    currency,
  });
}

/** Digits only, as typed into an amount field and read back by core's parseMoney: "1,28,417.00". */
export function formatAmountInput(amount: number, minorUnits: number): string {
  return formatMoney(amount, minorUnits, Intl, { locale: MONEY_LOCALE });
}

/**
 * `format(money)` with each currency's decimals (from /currencies). The amount's sign is dropped
 * unless `signed`: the words beside it ("you owe", "owes you") carry the direction.
 */
export function useFormatMoney() {
  const currencies = useQuery(currenciesQuery);
  return (money: Money, { signed = false }: { signed?: boolean } = {}) => {
    const minorUnits =
      currencies.data?.items.find((c) => c.code === money.currency)?.minorUnits ??
      DEFAULT_MINOR_UNITS;
    return formatAmount(signed ? money.amount : Math.abs(money.amount), money.currency, minorUnits);
  };
}

/** "1 person", "5 people"; "1 share", "2 shares" (DESIGN_SPEC §3: pluralise correctly). */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
