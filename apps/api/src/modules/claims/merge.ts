// Claiming a placeholder: merge placeholder P into user U (Blueprint 5.3, with the plan
// corrections). Used by invite acceptance and by claims through a matching email.

import {
  directPairs,
  findPgError,
  groupMembers,
  groups,
  transactionPayers,
  transactions,
  transactionShares,
  users,
  type Tx,
} from '@fairshare/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { AppError } from '../../http/errors';
import { recordActivity } from '../activity/record';

/** What a merge did: the groups U is now in, and each closed friendship's replacement. */
export type MergeResult = { groupIds: string[]; replaced: Map<string, string> };

/**
 * Merges placeholder P into user U inside the caller's transaction. Steps:
 *
 * 1. Lock P; it must be an unclaimed placeholder.
 * 2. Conflict: if U has any membership row, active or not, in a group where P is a member, abort
 *    with MERGE_CONFLICT. (Including former members: they can share transactions with P, and the
 *    app's role can't delete membership rows to make room.)
 * 3. Direct groups: for P's friendship with X, if U already has one with X, move P's transactions
 *    into U's and close P's; otherwise the pair becomes (U, X).
 * 4. Repoint P's memberships, payer rows and share rows to U.
 * 5. Mark P merged into U, and record member.claimed in each group.
 *
 * The activity log is append-only and keeps naming P; readers resolve it through merged_into.
 * Invites that targeted P keep doing so, and stop offering P once it's claimed. The deferred sum
 * triggers re-check every touched transaction at commit.
 */
export async function mergePlaceholder(
  tx: Tx,
  { placeholderId, userId }: { placeholderId: string; userId: string },
): Promise<MergeResult> {
  // NO KEY UPDATE: serializes claims of P without blocking foreign-key checks on P's row.
  const [placeholder] = await tx
    .select()
    .from(users)
    .where(eq(users.id, placeholderId))
    .for('no key update');
  if (
    !placeholder?.isPlaceholder ||
    placeholder.mergedInto !== null ||
    placeholder.deletedAt !== null
  ) {
    throw new AppError('PLACEHOLDER_UNAVAILABLE', 'This person has already been claimed.');
  }

  const memberships = await tx
    .select({ groupId: groupMembers.groupId, deletedAt: groups.deletedAt })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, placeholderId));
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length > 0) {
    const overlap = await tx
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, groupIds)))
      .limit(1);
    if (overlap.length > 0) throw mergeConflict();
  }

  // Groups the claim lands U in: P's live groups, with a closed friendship replaced by U's own.
  const affected = new Set(memberships.filter((m) => m.deletedAt === null).map((m) => m.groupId));
  const replaced = new Map<string, string>();

  const pairs = await tx
    .select()
    .from(directPairs)
    .where(or(eq(directPairs.userLow, placeholderId), eq(directPairs.userHigh, placeholderId)));
  for (const pair of pairs) {
    const other = pair.userLow === placeholderId ? pair.userHigh : pair.userLow;
    const [low, high] = sorted(userId, other);
    const [existing] = await tx
      .select()
      .from(directPairs)
      .where(and(eq(directPairs.userLow, low), eq(directPairs.userHigh, high)));
    await tx.delete(directPairs).where(eq(directPairs.groupId, pair.groupId));
    if (existing) {
      // U and X are already friends: one friendship, holding both histories.
      await tx
        .update(transactions)
        .set({ groupId: existing.groupId })
        .where(eq(transactions.groupId, pair.groupId));
      await tx
        .update(groupMembers)
        .set({ leftAt: sql`now()` })
        .where(and(eq(groupMembers.groupId, pair.groupId), sql`${groupMembers.leftAt} IS NULL`));
      await tx
        .update(groups)
        .set({ deletedAt: sql`now()` })
        .where(eq(groups.id, pair.groupId));
      affected.delete(pair.groupId);
      affected.add(existing.groupId);
      replaced.set(pair.groupId, existing.groupId);
    } else {
      await tx.insert(directPairs).values({ userLow: low, userHigh: high, groupId: pair.groupId });
    }
  }

  try {
    await tx.update(groupMembers).set({ userId }).where(eq(groupMembers.userId, placeholderId));
  } catch (error) {
    // A concurrent claim put U into one of these groups first (primary key group_id, user_id).
    if (findPgError(error)?.code === '23505') throw mergeConflict();
    throw error;
  }
  await tx
    .update(transactionPayers)
    .set({ userId })
    .where(eq(transactionPayers.userId, placeholderId));
  await tx
    .update(transactionShares)
    .set({ userId })
    .where(eq(transactionShares.userId, placeholderId));
  await tx.update(users).set({ mergedInto: userId }).where(eq(users.id, placeholderId));

  const groupsJoined = [...affected];
  await recordActivity(
    tx,
    ...groupsJoined.map((groupId) => ({
      groupId,
      actorId: userId,
      verb: 'member.claimed' as const,
      entityType: 'member' as const,
      entityId: userId,
      targetUser: placeholderId,
      after: { placeholderId, placeholderName: placeholder.name },
    })),
  );
  return { groupIds: groupsJoined, replaced };
}

const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

const mergeConflict = () =>
  new AppError(
    'MERGE_CONFLICT',
    'You’re already in this group. Ask the group to remove the placeholder instead.',
  );
