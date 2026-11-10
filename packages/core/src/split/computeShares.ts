import { DomainError, InvariantViolation } from '../errors';
import { assertValidAmount } from '../money/amount';
import { BASIS_POINTS_TOTAL, MAX_AMOUNT_MINOR } from '../money/constants';
import type { Line, Minor, UserId } from '../types';
import { allocateProportional, assertUniqueUsers, byUserId } from './allocate';

export type SplitMethod = 'equal' | 'exact' | 'percent' | 'shares';

/** How the user asked for the cost to be divided. Stored as-is so the editor can reopen faithfully. */
export type SplitInput =
  | { method: 'equal'; participants: UserId[] }
  | { method: 'exact'; amounts: Line[] }
  | { method: 'percent'; basisPoints: { userId: UserId; bp: number }[] }
  | { method: 'shares'; shares: { userId: UserId; shares: number }[] };

/** Largest weight one person can have in a share split ("3 shares for the family of three"). */
export const MAX_SHARES_PER_PERSON = 1000;

/**
 * Turns a split into exact per-person shares that add up to `total`.
 *
 * `seed` is the transaction's ID: the same (total, split, seed) always produces the same shares,
 * so the browser preview matches what the server saves and re-saving never moves a paisa.
 * Only positive shares are returned, sorted by userId. Someone with a 0 share has no share row.
 */
export function computeShares(total: Minor, split: SplitInput, seed: string): Line[] {
  assertValidAmount(total);

  switch (split.method) {
    case 'equal': {
      const weights = split.participants.map((userId) => ({ userId, weight: 1 }));
      return withoutZeros(allocateProportional(total, weights, seed));
    }

    case 'percent': {
      assertUniqueUsers(split.basisPoints.map((p) => p.userId));
      for (const { userId, bp } of split.basisPoints) {
        if (!Number.isSafeInteger(bp) || bp < 0 || bp > BASIS_POINTS_TOTAL) {
          throw new DomainError('INVALID_PERCENT', 'Each percentage must be from 0 to 100.', {
            userId,
            bp,
          });
        }
      }
      const sum = split.basisPoints.reduce((s, p) => s + p.bp, 0);
      if (sum !== BASIS_POINTS_TOTAL) {
        throw new DomainError('PERCENT_SUM_INVALID', 'Percentages must add up to 100%.', {
          expected: BASIS_POINTS_TOTAL,
          actual: sum,
        });
      }
      const weights = split.basisPoints.map((p) => ({ userId: p.userId, weight: p.bp }));
      return withoutZeros(allocateProportional(total, weights, seed));
    }

    case 'shares': {
      assertUniqueUsers(split.shares.map((s) => s.userId));
      for (const { userId, shares } of split.shares) {
        if (!Number.isSafeInteger(shares) || shares < 0 || shares > MAX_SHARES_PER_PERSON) {
          throw new DomainError(
            'INVALID_WEIGHT',
            `Shares must be whole numbers from 0 to ${MAX_SHARES_PER_PERSON}.`,
            { userId, shares },
          );
        }
      }
      const weights = split.shares.map((s) => ({ userId: s.userId, weight: s.shares }));
      return withoutZeros(allocateProportional(total, weights, seed));
    }

    case 'exact': {
      assertUniqueUsers(split.amounts.map((a) => a.userId));
      for (const { userId, amount } of split.amounts) {
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT_MINOR) {
          throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Each amount must be 0 or more.', {
            userId,
            amount,
          });
        }
      }
      const sum = split.amounts.reduce((s, a) => s + a.amount, 0);
      if (sum !== total) {
        throw new DomainError('SPLIT_SUM_MISMATCH', 'Split amounts must add up to the total.', {
          expected: total,
          actual: sum,
        });
      }
      return withoutZeros(split.amounts.map((a) => ({ userId: a.userId, amount: a.amount }))).sort(
        byUserId,
      );
    }

    default:
      throw new InvariantViolation('Unknown split method.', { split });
  }
}

function withoutZeros(lines: Line[]): Line[] {
  return lines.filter((l) => l.amount > 0);
}
