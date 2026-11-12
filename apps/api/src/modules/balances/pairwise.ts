import { simplify } from '@fairshare/core';
import type { NetRow } from './repo';

/** What another person and I owe each other, per currency: + they owe me, − I owe them. */
export type PairBalances = Map<string, Map<string, number>>;

/**
 * Friend balances (Blueprint 4.6): in each group and currency, simplify the members' nets into
 * suggested transfers, and keep the transfers between me and each other person. Summed over
 * everyone, these equal my own nets, so every screen agrees.
 */
export function pairwiseBalances(me: string, nets: NetRow[]): PairBalances {
  const byGroupCurrency = new Map<string, { userId: string; amount: number }[]>();
  for (const row of nets) {
    const key = `${row.groupId} ${row.currency}`;
    const lines = byGroupCurrency.get(key) ?? [];
    lines.push({ userId: row.userId, amount: row.net });
    byGroupCurrency.set(key, lines);
  }

  const result: PairBalances = new Map();
  const add = (other: string, currency: string, amount: number) => {
    const balances = result.get(other) ?? new Map<string, number>();
    balances.set(currency, (balances.get(currency) ?? 0) + amount);
    result.set(other, balances);
  };
  for (const [key, lines] of byGroupCurrency) {
    if (!lines.some((line) => line.userId === me)) continue;
    const currency = key.slice(key.indexOf(' ') + 1);
    for (const transfer of simplify(lines)) {
      if (transfer.to === me) add(transfer.from, currency, transfer.amount);
      else if (transfer.from === me) add(transfer.to, currency, -transfer.amount);
    }
  }
  return result;
}

/** A person's balances as Money, non-zero only, sorted by currency. */
export function toMoney(balances: Map<string, number> | undefined) {
  return [...(balances ?? new Map<string, number>())]
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ amount, currency }));
}
