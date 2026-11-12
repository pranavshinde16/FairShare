import { formatMoney } from '@fairshare/core';
import type { Money } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { currenciesQuery } from '../features/profile/queries';

/** Formats money in the browser's locale with each currency's decimals (from /currencies). */
export function useFormatMoney() {
  const currencies = useQuery(currenciesQuery);
  return (money: Money, { signed = false }: { signed?: boolean } = {}) => {
    const minorUnits =
      currencies.data?.items.find((c) => c.code === money.currency)?.minorUnits ?? 2;
    const amount = signed ? money.amount : Math.abs(money.amount);
    return formatMoney(amount, minorUnits, Intl, {
      locale: navigator.language,
      currency: money.currency,
    });
  };
}
