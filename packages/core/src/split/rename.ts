import { InvariantViolation } from '../errors';
import type { UserId } from '../types';
import { canonicalSplitInput } from './canonical';
import type { SplitInput } from './computeShares';

/** Every user a split input names, in the order they appear. */
export function splitInputUsers(split: SplitInput): UserId[] {
  switch (split.method) {
    case 'equal':
      return [...split.participants];
    case 'exact':
      return split.amounts.map((a) => a.userId);
    case 'percent':
      return split.basisPoints.map((p) => p.userId);
    case 'shares':
      return split.shares.map((s) => s.userId);
  }
}

/**
 * The same split with user `from` replaced by `to`, in canonical form. Used when a placeholder is
 * claimed: everything they were part of becomes the claimer's. Nothing else changes, values
 * included; only the order can, since lists are sorted by userId.
 *
 * Recomputing shares from the result can move a leftover minor unit between people (rounding
 * ties are broken by position in userId order), which is why an unchanged edit keeps the shares
 * stored before the claim (ARCHITECTURE, I5).
 *
 * `to` already in the split is a broken guarantee: claiming refuses anyone already in a group the
 * placeholder is in, so the two never share a transaction.
 */
export function renameInSplit(split: SplitInput, from: UserId, to: UserId): SplitInput {
  const users = splitInputUsers(split);
  if (from !== to && users.includes(from) && users.includes(to)) {
    throw new InvariantViolation('Renaming a user to someone already in the split', { from, to });
  }
  const swap = (userId: UserId) => (userId === from ? to : userId);
  switch (split.method) {
    case 'equal':
      return canonicalSplitInput({ method: 'equal', participants: split.participants.map(swap) });
    case 'exact':
      return canonicalSplitInput({
        method: 'exact',
        amounts: split.amounts.map((a) => ({ userId: swap(a.userId), amount: a.amount })),
      });
    case 'percent':
      return canonicalSplitInput({
        method: 'percent',
        basisPoints: split.basisPoints.map((p) => ({ userId: swap(p.userId), bp: p.bp })),
      });
    case 'shares':
      return canonicalSplitInput({
        method: 'shares',
        shares: split.shares.map((s) => ({ userId: swap(s.userId), shares: s.shares })),
      });
  }
}
