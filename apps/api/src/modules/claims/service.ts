import type { ClaimList, ClaimResponse } from '@fairshare/contracts';
import { groupMembers, groups, users, withTx, type Db } from '@fairshare/db';
import { aliasedTable, and, eq, inArray, isNull } from 'drizzle-orm';
import { AppError } from '../../http/errors';
import { mergePlaceholder } from './merge';

export type ClaimsService = ReturnType<typeof createClaimsService>;

/**
 * Placeholders someone created with my email address as the hint (plan correction: signing up with
 * a placeholder's email should offer it). Only ones I could claim are listed: unclaimed, still in a
 * live group, and in no group I've ever been a member of (that would be a merge conflict).
 */
export function createClaimsService(db: Db) {
  async function matching(me: string, placeholderId?: string) {
    const [self] = await db.select({ email: users.email }).from(users).where(eq(users.id, me));
    if (!self?.email) return [];
    const creator = aliasedTable(users, 'creator');
    const candidates = await db
      .select({ id: users.id, name: users.name, addedBy: creator.name })
      .from(users)
      .innerJoin(creator, eq(creator.id, users.createdBy))
      .where(
        and(
          eq(users.isPlaceholder, true),
          isNull(users.mergedInto),
          isNull(users.deletedAt),
          // users.email is citext, so this comparison ignores case.
          eq(users.email, self.email),
          placeholderId ? eq(users.id, placeholderId) : undefined,
        ),
      );
    if (candidates.length === 0) return [];

    const memberships = await db
      .select({
        userId: groupMembers.userId,
        leftAt: groupMembers.leftAt,
        id: groups.id,
        kind: groups.kind,
        name: groups.name,
        emoji: groups.emoji,
        deletedAt: groups.deletedAt,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(inArray(groupMembers.userId, [me, ...candidates.map((c) => c.id)]));
    const myGroups = new Set(memberships.filter((m) => m.userId === me).map((m) => m.id));

    return candidates.flatMap((candidate) => {
      const theirs = memberships.filter((m) => m.userId === candidate.id);
      if (theirs.some((m) => myGroups.has(m.id))) return [];
      const live = theirs.filter((m) => m.leftAt === null && m.deletedAt === null);
      if (live.length === 0) return [];
      return [
        {
          placeholder: { id: candidate.id, name: candidate.name },
          addedBy: { name: candidate.addedBy },
          groups: live.map(({ id, kind, name, emoji }) => ({ id, kind, name, emoji })),
        },
      ];
    });
  }

  const notClaimable = () =>
    new AppError('NOT_FOUND', 'There’s no placeholder for you to claim here.');

  return {
    /** GET /claims. */
    async list(me: string): Promise<ClaimList> {
      return { items: await matching(me) };
    },

    /** POST /claims/:placeholderId: merge the placeholder into me, as an invite claim does. */
    async claim(me: string, placeholderId: string): Promise<ClaimResponse> {
      if ((await matching(me, placeholderId)).length === 0) throw notClaimable();
      const { groupIds } = await withTx(db, (tx) =>
        mergePlaceholder(tx, { placeholderId, userId: me }),
      );
      return { groupIds };
    },

    /** DELETE /claims/:placeholderId: "that's not me". The email hint is removed. */
    async dismiss(me: string, placeholderId: string): Promise<void> {
      if ((await matching(me, placeholderId)).length === 0) throw notClaimable();
      await db.update(users).set({ email: null }).where(eq(users.id, placeholderId));
    },
  };
}
