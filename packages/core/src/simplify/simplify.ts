import { invariant } from '../invariants/invariant';
import { assertNetsSumToZero } from '../invariants/transaction';
import type { Line, Minor, UserId } from '../types';

export type Transfer = { from: UserId; to: UserId; amount: Minor };

/**
 * Suggests the payments that settle a group (one currency) with few transfers.
 *
 * Greedy: repeatedly match the largest debtor with the largest creditor and transfer the smaller of
 * the two amounts. Guarantees: every net is preserved exactly, at most n − 1 transfers for n people
 * with a non-zero balance, every amount is positive, and the output is deterministic (ties are
 * broken by userId). Finding the true minimum is NP-hard; greedy is optimal or within one transfer
 * in practice for groups of this size.
 */
export function simplify(nets: Line[]): Transfer[] {
  invariant(
    new Set(nets.map((n) => n.userId)).size === nets.length,
    'A person appears twice in the nets.',
  );
  assertNetsSumToZero(nets);

  const creditors = nets
    .filter((n) => n.amount > 0)
    .map((n) => ({ ...n }))
    .sort(largestFirst);
  const debtors = nets
    .filter((n) => n.amount < 0)
    .map((n) => ({ userId: n.userId, amount: -n.amount }))
    .sort(largestFirst);

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors.shift()!;
    const debtor = debtors.shift()!;
    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ from: debtor.userId, to: creditor.userId, amount });

    if (creditor.amount > amount) {
      insertSorted(creditors, { userId: creditor.userId, amount: creditor.amount - amount });
    }
    if (debtor.amount > amount) {
      insertSorted(debtors, { userId: debtor.userId, amount: debtor.amount - amount });
    }
  }
  invariant(creditors.length === 0 && debtors.length === 0, 'Simplification left a balance.');
  return transfers;
}

/** Larger amount first; equal amounts by userId, so the result never depends on input order. */
function largestFirst(a: Line, b: Line): number {
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.userId < b.userId ? -1 : 1;
}

function insertSorted(list: Line[], item: Line): void {
  const index = list.findIndex((other) => largestFirst(item, other) < 0);
  if (index === -1) list.push(item);
  else list.splice(index, 0, item);
}
