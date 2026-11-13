// Drizzle queries for the activity feeds (Blueprint 4.9 "Feeds"). The log itself is written by
// record.ts, in the same database transaction as each change.

import { activityLog, groupMembers, groups, users, type Db } from '@fairshare/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

export type ActivityRow = typeof activityLog.$inferSelect & {
  groupKind: 'group' | 'direct';
  groupName: string | null;
};

const columns = {
  ...getTableColumns(activityLog),
  groupKind: groups.kind,
  groupName: groups.name,
};

/** Every group the user has a membership row in, active or not. */
async function membershipGroupIds(db: Db, me: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, me));
  return rows.map((r) => r.groupId);
}

/**
 * Which entries a person's feed shows. Joined with their membership row (`groupMembers` for `me`):
 *
 * - In a group they're active in: what happened since they joined (joining an old group doesn't
 *   flood the feed). A deleted group shows only its "deleted" entry. A friendship's
 *   "group.created" is left out: its "added as a friend" entry says it all.
 * - In a group they're no longer in: only being removed from it, so they learn why it's gone.
 */
function visible(me: string): SQL {
  return or(
    and(
      isNull(groupMembers.leftAt),
      sql`${activityLog.createdAt} >= ${groupMembers.joinedAt}`,
      or(isNull(groups.deletedAt), eq(activityLog.verb, 'group.deleted')),
      sql`NOT (${groups.kind} = 'direct' AND ${activityLog.verb} = 'group.created')`,
    ),
    and(
      sql`${groupMembers.leftAt} IS NOT NULL`,
      eq(activityLog.verb, 'member.removed'),
      eq(activityLog.targetUser, me),
    ),
  )!;
}

/**
 * Someone else's entry, newer than when the person last opened Activity (never: all of them).
 * The time is compared in SQL, at Postgres's full precision: read into JavaScript it would lose its
 * microseconds, and an entry written in the same millisecond could count wrongly.
 */
function unread(me: string): SQL {
  return and(
    ne(activityLog.actorId, me),
    sql`${activityLog.createdAt} > coalesce(
      (SELECT ${users.activitySeenAt} FROM ${users} WHERE ${users.id} = ${me}),
      '-infinity'::timestamptz)`,
  )!;
}

type FeedScope = { me: string; groupId?: string };

/**
 * The scoped, visible entries as a query builder. The group IDs come first from the membership
 * rows, so the log is read through its (group_id, id) index rather than scanned whole.
 */
async function scoped(db: Db, { me, groupId }: FeedScope, select: 'rows' | 'count') {
  const groupIds = groupId ? [groupId] : await membershipGroupIds(db, me);
  if (groupIds.length === 0) return null;
  const base = (select === 'rows' ? db.select(columns) : db.select({ n: count() }))
    .from(activityLog)
    .innerJoin(groups, eq(groups.id, activityLog.groupId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, activityLog.groupId), eq(groupMembers.userId, me)),
    );
  return { base, inGroups: inArray(activityLog.groupId, groupIds) };
}

/**
 * A page of my feed, newest first (by ID, which follows insertion order). `groupId` narrows it to
 * one group; then the whole group's history shows, from before I joined too, since that group's
 * feed is its audit trail. Fetches one entry more than the limit to know if there's more.
 */
export async function feedPage(
  db: Db,
  scope: FeedScope,
  { before, limit }: { before?: number; limit: number },
): Promise<ActivityRow[]> {
  const q = await scoped(db, scope, 'rows');
  if (!q) return [];
  const where = scope.groupId
    ? [q.inGroups, isNull(groupMembers.leftAt)]
    : [q.inGroups, visible(scope.me)];
  if (before !== undefined) where.push(lt(activityLog.id, before));
  return (await q.base
    .where(and(...where))
    .orderBy(desc(activityLog.id))
    .limit(limit + 1)) as ActivityRow[];
}

/**
 * How many entries in my feed are unread. Unread is the same for an entry wherever it's shown, so
 * a group's count is my feed's, narrowed to that group.
 */
export async function unreadCount(db: Db, scope: FeedScope): Promise<number> {
  const q = await scoped(db, scope, 'count');
  if (!q) return 0;
  const [row] = (await q.base.where(and(q.inGroups, visible(scope.me), unread(scope.me)))) as {
    n: number;
  }[];
  return row!.n;
}

/** Which of these entries are unread for me: the same rule as unreadCount. */
export async function unreadAmong(db: Db, me: string, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(and(inArray(activityLog.id, ids), unread(me)));
  return new Set(rows.map((r) => r.id));
}

/** POST /activity/seen: everything up to now is read. */
export async function markSeen(db: Db, me: string): Promise<void> {
  await db
    .update(users)
    .set({ activitySeenAt: sql`now()` })
    .where(eq(users.id, me));
}

/** Placeholders this person claimed: old log entries still name them. */
export async function claimedPlaceholders(db: Db, me: string): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.mergedInto, me));
  return rows.map((r) => r.id);
}

/** One transaction's history, oldest first, with its group (GET /transactions/:id/history). */
export async function transactionHistory(db: Db, transactionId: string): Promise<ActivityRow[]> {
  return db
    .select(columns)
    .from(activityLog)
    .innerJoin(groups, eq(groups.id, activityLog.groupId))
    .where(and(eq(activityLog.entityType, 'transaction'), eq(activityLog.entityId, transactionId)))
    .orderBy(asc(activityLog.id));
}
