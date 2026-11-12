import type {
  AddMember,
  CreateGroup,
  Group,
  GroupList,
  Member,
  NewMember,
  UpdateGroup,
  UserRef,
} from '@fairshare/contracts';
import { findPgError, groups, withTx, type Db, type Tx } from '@fairshare/db';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../../http/errors';
import { uuidv7 } from '../../lib/ids';
import { recordActivity } from '../activity/record';
import { netsForGroups } from '../balances/repo';
import * as currencies from '../currencies/repo';
import {
  isEditableGroup,
  isGroupSettled,
  isOwner,
  isSettled,
  nextOwner,
  type Role,
} from './policies';
import * as repo from './repo';

/** The caller's membership, as requireMembership found it. */
export type Membership = { groupId: string; kind: 'group' | 'direct'; role: Role };

export type GroupsService = ReturnType<typeof createGroupsService>;

export function createGroupsService(db: Db) {
  async function getGroup(groupId: string, viewerId: string): Promise<Group> {
    const group = await repo.findGroup(db, groupId);
    if (!group || group.deletedAt) throw notFound();
    return toGroup(group, await repo.listMembers(db, groupId), viewerId);
  }

  return {
    getGroup,

    /** The caller's active membership in a group that isn't deleted, if any. */
    async membershipOf(groupId: string, userId: string): Promise<Membership | undefined> {
      const found = await repo.findActiveMembership(db, groupId, userId);
      return found && { groupId: found.group.id, kind: found.group.kind, role: found.role };
    },

    /**
     * POST /groups. A retry with the same ID returns the group already made (200); an ID that
     * belongs to someone else's group is ID_CONFLICT.
     */
    async createGroup(me: string, input: CreateGroup): Promise<{ group: Group; created: boolean }> {
      const replay = async () => {
        const existing = await repo.findGroup(db, input.id);
        if (existing?.createdBy === me && existing.kind === 'group' && !existing.deletedAt) {
          return { group: await getGroup(input.id, me), created: false };
        }
        throw new AppError('ID_CONFLICT', 'A group with this ID already exists.');
      };
      if (await repo.findGroup(db, input.id)) return replay();
      if (!(await currencies.exists(db, input.currency))) {
        throw invalid(['currency'], 'Unsupported currency');
      }

      try {
        await withTx(db, async (tx) => {
          await tx.insert(groups).values({
            id: input.id,
            kind: 'group',
            name: input.name,
            emoji: input.emoji ?? null,
            currency: input.currency,
            createdBy: me,
          });
          const added: string[] = [];
          for (const [index, member] of (input.members ?? []).entries()) {
            const userId = await resolveNewMember(tx, me, member, ['members', index]);
            if (userId === me || added.includes(userId)) continue; // listed twice: once is enough
            added.push(userId);
          }
          await repo.insertMembers(tx, input.id, [
            { userId: me, role: 'owner' },
            ...added.map((userId) => ({ userId, role: 'member' as const })),
          ]);
          await recordActivity(
            tx,
            {
              groupId: input.id,
              actorId: me,
              verb: 'group.created',
              entityType: 'group',
              entityId: input.id,
              after: { name: input.name, emoji: input.emoji ?? null, currency: input.currency },
            },
            ...added.map((userId) => memberAdded(input.id, me, userId)),
          );
        });
      } catch (error) {
        // Two requests with the same new ID: the second one hits the primary key.
        if (findPgError(error)?.code === '23505') return replay();
        throw error;
      }
      return { group: await getGroup(input.id, me), created: true };
    },

    /** GET /groups: my regular groups, newest first, each with my net per currency. */
    async listGroups(me: string): Promise<GroupList> {
      const mine = await repo.listMyGroups(db, me, 'group');
      const ids = mine.map((g) => g.id);
      const [members, nets] = await Promise.all([
        repo.listMembersOf(db, ids),
        netsForGroups(db, ids),
      ]);
      return {
        items: mine.map((group) => {
          const myNet = nets
            .filter((row) => row.groupId === group.id && row.userId === me)
            .map((row) => ({ amount: row.net, currency: row.currency }))
            .sort((a, b) => a.currency.localeCompare(b.currency));
          const groupMembers = members.filter((m) => m.groupId === group.id);
          return { ...(toGroup(group, groupMembers, me) as Group & { kind: 'group' }), myNet };
        }),
      };
    },

    /** PATCH /groups/:groupId. The currency can change only while the group has no transactions. */
    async updateGroup(me: string, membership: Membership, input: UpdateGroup): Promise<Group> {
      if (!isEditableGroup(membership.kind)) throw directGroup();
      if (input.currency && !(await currencies.exists(db, input.currency))) {
        throw invalid(['currency'], 'Unsupported currency');
      }
      await withTx(db, async (tx) => {
        const group = await repo.lockGroup(tx, membership.groupId);
        if (!group || group.deletedAt) throw notFound();
        const changes: Partial<Pick<typeof group, 'name' | 'emoji' | 'currency'>> = {};
        if (input.name !== undefined && input.name !== group.name) changes.name = input.name;
        if (input.emoji !== undefined && input.emoji !== group.emoji) changes.emoji = input.emoji;
        if (input.currency !== undefined && input.currency !== group.currency) {
          if (await repo.hasTransactions(tx, group.id)) {
            throw new AppError(
              'CURRENCY_LOCKED',
              'The currency can’t change once the group has expenses.',
            );
          }
          changes.currency = input.currency;
        }
        if (Object.keys(changes).length === 0) return;

        await tx.update(groups).set(changes).where(eq(groups.id, group.id));
        const { name, ...rest } = changes;
        const entries = [];
        if (name !== undefined) {
          entries.push({
            groupId: group.id,
            actorId: me,
            verb: 'group.renamed' as const,
            entityType: 'group' as const,
            entityId: group.id,
            before: { name: group.name },
            after: { name },
          });
        }
        if (Object.keys(rest).length > 0) {
          entries.push({
            groupId: group.id,
            actorId: me,
            verb: 'group.updated' as const,
            entityType: 'group' as const,
            entityId: group.id,
            before: Object.fromEntries(
              Object.keys(rest).map((key) => [key, group[key as keyof typeof rest]]),
            ),
            after: rest,
          });
        }
        await recordActivity(tx, ...entries);
      });
      return getGroup(membership.groupId, me);
    },

    /** DELETE /groups/:groupId: the owner, once every balance is zero. A soft delete. */
    async deleteGroup(me: string, membership: Membership): Promise<void> {
      if (!isEditableGroup(membership.kind)) throw directGroup();
      if (!isOwner(membership.role)) throw ownerOnly();
      await withTx(db, async (tx) => {
        const group = await repo.lockGroup(tx, membership.groupId);
        if (!group || group.deletedAt) throw notFound();
        if (!isGroupSettled(await netsForGroups(tx, [group.id]))) {
          throw new AppError(
            'BALANCE_NOT_ZERO',
            'Everyone must be settled up before the group can be deleted.',
          );
        }
        await softDelete(tx, group.id, me, group.name);
      });
    },

    /** POST /groups/:groupId/members. Someone who left is brought back. */
    async addMember(me: string, membership: Membership, input: AddMember): Promise<Member> {
      if (!isEditableGroup(membership.kind)) throw directGroup();
      const groupId = membership.groupId;
      const userId = await withTx(db, async (tx) => {
        await repo.lockGroup(tx, groupId);
        const userId = await resolveNewMember(tx, me, input, []);
        const existing = await repo.findMembership(tx, groupId, userId);
        if (existing && existing.leftAt === null) {
          throw new AppError('ALREADY_MEMBER', 'This person is already in the group.');
        }
        if (existing) await repo.rejoin(tx, groupId, userId);
        else await repo.insertMembers(tx, groupId, [{ userId, role: 'member' }]);
        await recordActivity(tx, memberAdded(groupId, me, userId));
        return userId;
      });
      const member = (await repo.listMembers(db, groupId)).find((m) => m.userId === userId)!;
      return toMember(member);
    },

    /**
     * DELETE /groups/:groupId/members/:userId. With my own ID it's leaving; otherwise the owner
     * removes a member. Either way the person's balance must be zero in every currency.
     */
    async removeMember(me: string, membership: Membership, userId: string): Promise<void> {
      if (!isEditableGroup(membership.kind)) throw directGroup();
      const groupId = membership.groupId;
      const leaving = userId === me;
      if (!leaving && !isOwner(membership.role)) throw ownerOnly();

      await withTx(db, async (tx) => {
        const group = await repo.lockGroup(tx, groupId);
        if (!group || group.deletedAt) throw notFound();
        const members = await repo.listMembers(tx, groupId);
        const target = members.find((m) => m.userId === userId && m.leftAt === null);
        if (!target) throw notFound('This person isn’t in the group.');
        if (!isSettled(userId, await netsForGroups(tx, [groupId]))) {
          throw new AppError(
            'BALANCE_NOT_ZERO',
            leaving
              ? 'Settle up before leaving the group.'
              : 'This person must be settled up before they can be removed.',
          );
        }

        await repo.markLeft(tx, groupId, userId);
        if (!leaving) {
          await recordActivity(tx, {
            groupId,
            actorId: me,
            verb: 'member.removed',
            entityType: 'member',
            entityId: userId,
            targetUser: userId,
          });
          return;
        }

        const newOwner = target.role === 'owner' ? nextOwner(members, me) : null;
        if (newOwner) await repo.makeOwner(tx, groupId, newOwner);
        await recordActivity(tx, {
          groupId,
          actorId: me,
          verb: 'member.left',
          entityType: 'member',
          entityId: me,
          targetUser: me,
          after: newOwner ? { newOwnerId: newOwner } : null,
        });
        // The last member with an account is gone: nobody can open the group any more.
        if (target.role === 'owner' && !newOwner) await softDelete(tx, groupId, me, group.name);
      });
    },
  };
}

/**
 * The user ID for someone being added: an existing person I share a group with, or a new
 * placeholder. An email is kept on the placeholder as a hint, and never matched against accounts
 * here: the person with that address is offered to claim it instead (GET /claims), so adding
 * someone can't reveal whether they have an account, and nobody is added to a group without
 * agreeing.
 */
export async function resolveNewMember(
  tx: Tx,
  me: string,
  member: NewMember,
  path: (string | number)[],
): Promise<string> {
  if ('userId' in member) {
    const person = await repo.findAddableUser(tx, member.userId);
    if (member.userId !== me && (!person || !(await repo.shareAGroup(tx, me, member.userId)))) {
      throw invalid([...path, 'userId'], 'Not someone you share a group with');
    }
    return member.userId;
  }
  const id = uuidv7();
  await repo.insertPlaceholder(tx, {
    id,
    name: member.name,
    email: member.email ?? null,
    createdBy: me,
  });
  return id;
}

async function softDelete(tx: Tx, groupId: string, actorId: string, name: string | null) {
  await tx
    .update(groups)
    .set({ deletedAt: sql`now()` })
    .where(eq(groups.id, groupId));
  await recordActivity(tx, {
    groupId,
    actorId,
    verb: 'group.deleted',
    entityType: 'group',
    entityId: groupId,
    before: { name },
  });
}

export function memberAdded(groupId: string, actorId: string, userId: string) {
  return {
    groupId,
    actorId,
    verb: 'member.added' as const,
    entityType: 'member' as const,
    entityId: userId,
    targetUser: userId,
  };
}

export function toUserRef(person: {
  userId?: string;
  id?: string;
  name: string;
  avatarUrl: string | null;
  isPlaceholder: boolean;
}): UserRef {
  return {
    id: (person.userId ?? person.id)!,
    name: person.name,
    avatarUrl: person.avatarUrl,
    isPlaceholder: person.isPlaceholder,
  };
}

export function toMember(row: repo.MemberRow): Member {
  return {
    user: toUserRef(row),
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
    leftAt: row.leftAt?.toISOString() ?? null,
  };
}

/** The API shape of a group as `viewerId` sees it. Active members first, then those who left. */
export function toGroup(group: repo.GroupRow, members: repo.MemberRow[], viewerId: string): Group {
  const ordered = [
    ...members.filter((m) => m.leftAt === null),
    ...members.filter((m) => m.leftAt !== null),
  ];
  const myRole = members.find((m) => m.userId === viewerId)?.role ?? 'member';
  const common = {
    id: group.id,
    emoji: group.emoji,
    currency: group.currency,
    createdAt: group.createdAt.toISOString(),
    members: ordered.map(toMember),
    myRole,
  };
  return group.kind === 'direct'
    ? { kind: 'direct', name: null, ...common }
    : { kind: 'group', name: group.name ?? '', ...common };
}

export function invalid(path: (string | number)[], message: string) {
  return new AppError('VALIDATION_FAILED', 'The request is invalid.', {
    issues: [{ path, message, code: 'custom' }],
  });
}

export const notFound = (message = 'This group doesn’t exist or you’re not a member.') =>
  new AppError('NOT_FOUND', message);

const directGroup = () =>
  new AppError('CANNOT_MODIFY_DIRECT_GROUP', 'A friendship can’t be changed that way.');

const ownerOnly = () => new AppError('NOT_PERMITTED', 'Only the group’s owner can do that.');
