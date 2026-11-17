import type { Line } from '../types';
import { byUserId } from './allocate';
import type { SplitInput } from './computeShares';

/** Lines sorted by userId, rebuilt so their keys always come in the same order. */
export function sortLines(lines: readonly Line[]): Line[] {
  return lines.map((l) => ({ userId: l.userId, amount: l.amount })).sort(byUserId);
}

/**
 * A split input in its one canonical form: every list sorted by userId, every entry rebuilt.
 *
 * Entries are rebuilt, not just sorted, so their keys always come in the same order: a split read
 * back from Postgres (jsonb orders keys its own way, `bp` before `userId`) must serialize exactly
 * like one built from a request, or an unchanged edit or a replayed create looks different.
 */
export function canonicalSplitInput(input: SplitInput): SplitInput {
  switch (input.method) {
    case 'equal':
      return { method: 'equal', participants: [...input.participants].sort() };
    case 'exact':
      return { method: 'exact', amounts: sortLines(input.amounts) };
    case 'percent':
      return {
        method: 'percent',
        basisPoints: input.basisPoints.map(({ userId, bp }) => ({ userId, bp })).sort(byUserId),
      };
    case 'shares':
      return {
        method: 'shares',
        shares: input.shares.map(({ userId, shares }) => ({ userId, shares })).sort(byUserId),
      };
  }
}

/** Whether two split inputs are the same once both are canonical. */
export function sameSplitInput(a: SplitInput, b: SplitInput): boolean {
  return JSON.stringify(canonicalSplitInput(a)) === JSON.stringify(canonicalSplitInput(b));
}
