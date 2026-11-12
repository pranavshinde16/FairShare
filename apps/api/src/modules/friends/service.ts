import type { AddFriend, AddFriendResponse, PeopleList, UserRef } from '@fairshare/contracts';
import { directPairs, findPgError, groups, users, withTx, type Db } from '@fairshare/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '../../lib/ids';
import { recordActivity } from '../activity/record';
import * as groupsRepo from '../groups/repo';
import { invalid, memberAdded, resolveNewMember, toUserRef } from '../groups/service';

export type FriendsService = ReturnType<typeof createFriendsService>;

/** direct_pairs stores each pair once, the smaller ID first (as Postgres orders UUIDs). */
const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export function createFriendsService(db: Db) {
  async function findPair(a: string, b: string): Promise<string | undefined> {
    const [low, high] = sorted(a, b);
    const [row] = await db
      .select({ groupId: directPairs.groupId })
      .from(directPairs)
      .where(and(eq(directPairs.userLow, low), eq(directPairs.userHigh, high)));
    return row?.groupId;
  }

  async function userRef(id: string): Promise<UserRef> {
    const [row] = await db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        isPlaceholder: users.isPlaceholder,
      })
      .from(users)
      .where(eq(users.id, id));
    return toUserRef(row!);
  }

  return {
    /**
     * POST /friends: finds or creates the friendship (a direct group). Two requests racing for the
     * same pair both end up with the one group: the loser's insert into direct_pairs fails, its
     * transaction rolls back, and it returns the winner's group.
     */
    async addFriend(
      me: string,
      input: AddFriend,
    ): Promise<{ response: AddFriendResponse; created: boolean }> {
      // Postgres prints UUIDs in lower case; compare and sort them the same way.
      const other = 'userId' in input ? input.userId.toLowerCase() : null;
      if (other === me) throw invalid(['userId'], 'You can’t add yourself as a friend');
      if (other) {
        const existing = await findPair(me, other);
        if (existing)
          return { response: { groupId: existing, friend: await userRef(other) }, created: false };
      }

      const groupId = uuidv7();
      let friendId: string;
      try {
        friendId = await withTx(db, async (tx) => {
          const friend = await resolveNewMember(tx, me, other ? { userId: other } : input, []);
          const [self] = await tx
            .select({ currency: users.defaultCurrency })
            .from(users)
            .where(eq(users.id, me));
          await tx.insert(groups).values({
            id: groupId,
            kind: 'direct',
            name: null,
            currency: self!.currency,
            createdBy: me,
          });
          // A friendship has no owner: both are plain members.
          await groupsRepo.insertMembers(tx, groupId, [
            { userId: me, role: 'member' },
            { userId: friend, role: 'member' },
          ]);
          const [low, high] = sorted(me, friend);
          await tx.insert(directPairs).values({ userLow: low, userHigh: high, groupId });
          await recordActivity(
            tx,
            { groupId, actorId: me, verb: 'group.created', entityType: 'group', entityId: groupId },
            memberAdded(groupId, me, friend),
          );
          return friend;
        });
      } catch (error) {
        const existing =
          other && findPgError(error)?.code === '23505' ? await findPair(me, other) : undefined;
        if (existing)
          return { response: { groupId: existing, friend: await userRef(other!) }, created: false };
        throw error;
      }
      return { response: { groupId, friend: await userRef(friendId) }, created: true };
    },

    /** GET /people: everyone I share an active group with, by name. */
    async listPeople(me: string): Promise<PeopleList> {
      const people = await groupsRepo.listPeopleISeeIn(db, me);
      people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return { items: people.map(toUserRef) };
    },
  };
}
