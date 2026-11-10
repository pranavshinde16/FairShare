import { DomainError } from '../errors';
import { invariant } from '../invariants/invariant';
import { MAX_AMOUNT_MINOR } from '../money/constants';
import type { Line, Minor, UserId } from '../types';
import { fnv1a32 } from './hash';

export type Weight = { userId: UserId; weight: number };

/**
 * Splits `total` minor units in proportion to integer weights, exactly.
 *
 * 1. Canonicalize: sort by userId (input order never matters) and drop zero weights.
 * 2. Each person gets floor(total × weight / Σweights), computed in BigInt.
 * 3. The few leftover units (always fewer than the number of people) go one each to the largest
 *    remainders. Ties are broken by a rotation derived from `seed`, so across many transactions
 *    nobody always absorbs the extra paisa, yet the same seed always gives the same result.
 *
 * Every person's amount is within one minor unit of their exact proportional value, and the
 * amounts always add up to `total`. Returned lines are sorted by userId and include people whose
 * amount rounded to 0.
 */
export function allocateProportional(total: Minor, weights: Weight[], seed: string): Line[] {
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_AMOUNT_MINOR) {
    throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Total is out of range.', {
      min: 0,
      max: MAX_AMOUNT_MINOR,
      actual: total,
    });
  }
  assertUniqueUsers(weights.map((w) => w.userId));
  for (const { userId, weight } of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new DomainError('INVALID_WEIGHT', 'Weights must be whole numbers of 0 or more.', {
        userId,
        weight,
      });
    }
  }

  const entries = weights.filter((w) => w.weight > 0).sort(byUserId);
  if (entries.length === 0) {
    throw new DomainError('NO_PARTICIPANTS', 'At least one person must share the cost.');
  }

  const bigTotal = BigInt(total);
  const sumWeights = entries.reduce((sum, e) => sum + BigInt(e.weight), 0n);
  const amounts = entries.map((e) => (bigTotal * BigInt(e.weight)) / sumWeights);
  const remainders = entries.map((e) => (bigTotal * BigInt(e.weight)) % sumWeights);
  let leftover = bigTotal - amounts.reduce((sum, a) => sum + a, 0n);

  const n = entries.length;
  const start = fnv1a32(seed) % n;
  const rotation = (i: number) => (i - start + n) % n;
  const order = entries.map((_, i) => i);
  order.sort((a, b) => {
    const ra = remainders[a]!;
    const rb = remainders[b]!;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return rotation(a) - rotation(b);
  });
  for (const i of order) {
    if (leftover === 0n) break;
    amounts[i]! += 1n;
    leftover -= 1n;
  }

  const lines = entries.map((e, i) => ({ userId: e.userId, amount: Number(amounts[i]) }));
  const allocated = lines.reduce((sum, l) => sum + l.amount, 0);
  invariant(allocated === total, 'Allocation does not add up to the total.', { total, allocated });
  return lines;
}

export function byUserId(a: { userId: UserId }, b: { userId: UserId }): number {
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? -1 : 1;
}

export function assertUniqueUsers(userIds: UserId[]): void {
  const seen = new Set<UserId>();
  for (const userId of userIds) {
    if (seen.has(userId)) {
      throw new DomainError('DUPLICATE_USER', 'Each person can appear only once.', { userId });
    }
    seen.add(userId);
  }
}
