import type { ActivityFeed, ActivityListQuery } from '@fairshare/contracts';
import type { Db } from '@fairshare/db';
import { invalid, type Membership } from '../groups/service';
import { presentEntries } from './present';
import * as repo from './repo';

export type ActivityService = ReturnType<typeof createActivityService>;

/** The Activity tab and a group's activity (Blueprint 4.9 "Feeds", 6.3). */
export function createActivityService(db: Db) {
  async function feed(me: string, query: ActivityListQuery, groupId?: string) {
    const scope = { me, ...(groupId && { groupId }) };
    const [rows, unreadCount] = await Promise.all([
      repo.feedPage(db, scope, {
        ...(query.cursor && { before: decodeCursor(query.cursor) }),
        limit: query.limit,
      }),
      repo.unreadCount(db, scope),
    ]);
    const page = rows.slice(0, query.limit);
    const { items, people } = await presentEntries(db, page, me);
    return {
      items,
      nextCursor: rows.length > query.limit ? encodeCursor(page.at(-1)!.id) : null,
      unreadCount,
      people,
    } satisfies ActivityFeed;
  }

  return {
    /** GET /activity: changes across my groups, newest first, with how many are unread. */
    feed: (me: string, query: ActivityListQuery) => feed(me, query),

    /** GET /groups/:groupId/activity: the group's whole history, newest first. */
    groupFeed: (me: string, membership: Membership, query: ActivityListQuery) =>
      feed(me, query, membership.groupId),

    /** POST /activity/seen: I've looked; the unread count starts again from zero. */
    markSeen: (me: string) => repo.markSeen(db, me),
  };
}

/** Cursors are base64url of the last entry's ID, opaque to clients. */
export function encodeCursor(id: number): string {
  return Buffer.from(String(id)).toString('base64url');
}

export function decodeCursor(cursor: string): number {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const id = /^[1-9]\d{0,15}$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(id)) throw invalid(['cursor'], 'Invalid cursor');
  return id;
}
