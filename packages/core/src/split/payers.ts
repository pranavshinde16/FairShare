import { DomainError } from '../errors';
import { assertValidAmount, isValidAmount } from '../money/amount';
import type { Line, Minor, UserId } from '../types';
import { allocateProportional, assertUniqueUsers, byUserId } from './allocate';

/**
 * Checks who paid: at least one payer, each person once, each amount positive, and the amounts
 * adding up to the total. Returns the payers sorted by userId.
 */
export function validatePayers(total: Minor, payers: Line[]): Line[] {
  assertValidAmount(total);
  if (payers.length === 0) {
    throw new DomainError('NO_PARTICIPANTS', 'At least one person must have paid.');
  }
  assertUniqueUsers(payers.map((p) => p.userId));
  for (const { userId, amount } of payers) {
    if (!isValidAmount(amount)) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Each payer must have paid more than 0.', {
        userId,
        amount,
      });
    }
  }
  const sum = payers.reduce((s, p) => s + p.amount, 0);
  if (sum !== total) {
    throw new DomainError('PAYER_SUM_MISMATCH', 'What people paid must add up to the total.', {
      expected: total,
      actual: sum,
    });
  }
  return payers.map((p) => ({ userId: p.userId, amount: p.amount })).sort(byUserId);
}

/**
 * The "split payment equally" helper for multiple payers. Uses a seed distinct from the share
 * split's, so the paisa rotation for payers is independent of the one for shares. If the total is
 * smaller than the number of payers, people whose part rounds to 0 are left out.
 */
export function splitPaymentEqually(total: Minor, payerIds: UserId[], seed: string): Line[] {
  assertValidAmount(total);
  const weights = payerIds.map((userId) => ({ userId, weight: 1 }));
  return allocateProportional(total, weights, `${seed}:payers`).filter((l) => l.amount > 0);
}
