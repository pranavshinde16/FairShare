import { assertNetsSumToZero } from '../invariants/transaction';
import { DomainError } from '../errors';
import { assertValidAmount } from '../money/amount';
import { byUserId } from '../split/allocate';
import type { Line, Minor, UserId } from '../types';
import type { CurrencyNets, LedgerTransaction } from './types';

/**
 * One transaction's effect on each person: what they paid minus their share. Positive means the
 * person is owed, negative means they owe. People whose effect is exactly 0 are omitted.
 *
 * Expense: A pays 1,200 split A/B/C → A +800, B −400, C −400.
 * Settlement: B pays A 400 → B +400, A −400 (the payer hands over money; the recipient "consumes"
 * the payment).
 */
export function ledgerLines(tx: Pick<LedgerTransaction, 'payers' | 'shares'>): Line[] {
  const net = new Map<UserId, Minor>();
  for (const p of tx.payers) net.set(p.userId, (net.get(p.userId) ?? 0) + p.amount);
  for (const s of tx.shares) net.set(s.userId, (net.get(s.userId) ?? 0) - s.amount);
  return toSortedLines(net);
}

/**
 * Every person's balance, per currency, over a set of active (non-deleted) transactions.
 * Currencies are never mixed. Each currency's nets are checked to sum to zero (invariant I6).
 */
export function netsFromTransactions(
  transactions: Pick<LedgerTransaction, 'currency' | 'payers' | 'shares'>[],
): CurrencyNets[] {
  const byCurrency = new Map<string, Map<UserId, Minor>>();
  for (const tx of transactions) {
    let nets = byCurrency.get(tx.currency);
    if (!nets) {
      nets = new Map();
      byCurrency.set(tx.currency, nets);
    }
    for (const line of ledgerLines(tx)) {
      nets.set(line.userId, (nets.get(line.userId) ?? 0) + line.amount);
    }
  }

  return [...byCurrency.keys()].sort().map((currency) => {
    const nets = toSortedLines(byCurrency.get(currency)!);
    assertNetsSumToZero(nets, { currency });
    return { currency, nets };
  });
}

export type SettlementInput = { fromUserId: UserId; toUserId: UserId; amount: Minor };

/** Builds a settlement's payer and share rows: the payer hands money to the recipient. */
export function settlementLines(input: SettlementInput): { payers: Line[]; shares: Line[] } {
  assertValidAmount(input.amount);
  if (input.fromUserId === input.toUserId) {
    throw new DomainError(
      'SETTLEMENT_SAME_USER',
      'A payment must be between two different people.',
      {
        userId: input.fromUserId,
      },
    );
  }
  return {
    payers: [{ userId: input.fromUserId, amount: input.amount }],
    shares: [{ userId: input.toUserId, amount: input.amount }],
  };
}

function toSortedLines(map: Map<UserId, Minor>): Line[] {
  return [...map]
    .filter(([, amount]) => amount !== 0)
    .map(([userId, amount]) => ({ userId, amount }))
    .sort(byUserId);
}
