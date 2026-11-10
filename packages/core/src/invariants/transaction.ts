import type { LedgerTransaction } from '../ledger/types';
import { isValidAmount } from '../money/amount';
import type { Line } from '../types';
import { invariant } from './invariant';

/**
 * The last check before a transaction is written. Unlike computeShares (which rejects bad user
 * input with DomainError), a failure here means the code built an inconsistent transaction.
 *
 * I1: Σ payers = amount. I2: Σ shares = amount. I3 (ledger sums to 0) follows from both.
 * I9: a settlement has exactly one payer and one share, between two different people.
 * I10: every amount is a positive safe integer within the cap.
 */
export function assertTransactionInvariants(tx: LedgerTransaction): void {
  const ctx = { transactionId: tx.id };
  invariant(isValidAmount(tx.amount), 'Transaction amount is out of range.', {
    ...ctx,
    amount: tx.amount,
  });
  assertLines(tx.payers, 'payers', tx.amount, ctx);
  assertLines(tx.shares, 'shares', tx.amount, ctx);

  if (tx.type === 'settlement') {
    invariant(
      tx.payers.length === 1 && tx.shares.length === 1,
      'A settlement must have exactly one payer and one recipient.',
      ctx,
    );
    invariant(
      tx.payers[0]!.userId !== tx.shares[0]!.userId,
      'A settlement must be between two different people.',
      ctx,
    );
  }
}

/** I6: within one group and currency, everyone's nets add up to exactly zero. */
export function assertNetsSumToZero(
  nets: Line[],
  context?: Readonly<Record<string, unknown>>,
): void {
  let sum = 0;
  for (const { userId, amount } of nets) {
    invariant(Number.isSafeInteger(amount), 'Net is not a safe integer.', {
      ...context,
      userId,
      amount,
    });
    sum += amount;
  }
  invariant(sum === 0, 'Nets do not sum to zero.', { ...context, sum });
}

function assertLines(
  lines: Line[],
  kind: 'payers' | 'shares',
  amount: number,
  ctx: Record<string, unknown>,
): void {
  invariant(lines.length > 0, `Transaction has no ${kind}.`, ctx);
  invariant(
    new Set(lines.map((l) => l.userId)).size === lines.length,
    `Transaction lists a person twice in ${kind}.`,
    ctx,
  );
  for (const line of lines) {
    invariant(isValidAmount(line.amount), `Transaction has an invalid amount in ${kind}.`, {
      ...ctx,
      ...line,
    });
  }
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  invariant(sum === amount, `Transaction ${kind} do not add up to its amount.`, {
    ...ctx,
    sum,
    amount,
  });
}
