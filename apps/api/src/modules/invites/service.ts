import type {
  AcceptInvite,
  AcceptInviteResponse,
  CreateInvite,
  InviteCreated,
  InvitePreview,
} from '@fairshare/contracts';
import { groupMembers, groups, invites, users, withTx, type Db, type Tx } from '@fairshare/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../http/errors';
import { uuidv7 } from '../../lib/ids';
import { recordActivity } from '../activity/record';
import { mergePlaceholder } from '../claims/merge';
import { canRevokeInvite, isEditableGroup } from '../groups/policies';
import * as groupsRepo from '../groups/repo';
import { memberAdded, type Membership } from '../groups/service';

/** Invite links work for 30 days, any number of times. */
export const INVITE_TTL_DAYS = 30;

/** 32 random bytes in base64url (43 characters). Only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export type InvitesService = ReturnType<typeof createInvitesService>;

export function createInvitesService(db: Db, appUrl: string) {
  /** The invite behind a token, unless it's unknown, revoked, or its group is deleted. */
  async function findLive(handle: Db | Tx, token: string) {
    const [row] = await handle
      .select({ invite: invites, group: groups })
      .from(invites)
      .innerJoin(groups, eq(groups.id, invites.groupId))
      .where(
        and(
          eq(invites.tokenHash, hashToken(token)),
          isNull(invites.revokedAt),
          isNull(groups.deletedAt),
        ),
      );
    if (!row) throw new AppError('NOT_FOUND', 'This invite link doesn’t work any more.');
    return row;
  }

  /** Unclaimed placeholders still in the group: whom an invite can let someone become. */
  async function claimablePlaceholders(handle: Db | Tx, groupId: string) {
    return handle
      .select({ id: users.id, name: users.name })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          isNull(groupMembers.leftAt),
          eq(users.isPlaceholder, true),
          isNull(users.mergedInto),
          isNull(users.deletedAt),
        ),
      )
      .orderBy(users.name, users.id);
  }

  return {
    /**
     * POST /groups/:groupId/invites. A friendship takes only a link aimed at its placeholder
     * friend (plan correction): anyone else joining would make it a three-person group.
     */
    async createInvite(
      me: string,
      membership: Membership,
      input: CreateInvite,
    ): Promise<InviteCreated> {
      const groupId = membership.groupId;
      if (!isEditableGroup(membership.kind) && !input.targetPlaceholderId) {
        throw new AppError(
          'CANNOT_MODIFY_DIRECT_GROUP',
          'A friendship takes only a link for the friend who hasn’t joined yet.',
        );
      }
      const token = newToken();
      const id = uuidv7();
      const expiresAt = await withTx(db, async (tx) => {
        if (input.targetPlaceholderId) {
          const placeholders = await claimablePlaceholders(tx, groupId);
          if (!placeholders.some((p) => p.id === input.targetPlaceholderId)) {
            throw new AppError(
              'PLACEHOLDER_UNAVAILABLE',
              'That person isn’t an unclaimed placeholder in this group.',
            );
          }
        }
        const [invite] = await tx
          .insert(invites)
          .values({
            id,
            groupId,
            tokenHash: hashToken(token),
            targetPlaceholder: input.targetPlaceholderId ?? null,
            createdBy: me,
            expiresAt: sql`now() + make_interval(days => ${INVITE_TTL_DAYS})`,
          })
          .returning({ expiresAt: invites.expiresAt });
        await recordActivity(tx, {
          groupId,
          actorId: me,
          verb: 'invite.created',
          entityType: 'invite',
          entityId: id,
          targetUser: input.targetPlaceholderId ?? null,
        });
        return invite!.expiresAt;
      });
      return { id, url: `${appUrl}/invite/${token}`, expiresAt: expiresAt.toISOString() };
    },

    /** DELETE /groups/:groupId/invites/:inviteId: its creator or the owner. */
    async revokeInvite(me: string, membership: Membership, inviteId: string): Promise<void> {
      await withTx(db, async (tx) => {
        const [invite] = await tx
          .select()
          .from(invites)
          .where(
            and(
              eq(invites.id, inviteId),
              eq(invites.groupId, membership.groupId),
              isNull(invites.revokedAt),
            ),
          )
          .for('no key update');
        if (!invite) throw new AppError('NOT_FOUND', 'No such invite in this group.');
        if (!canRevokeInvite(me, membership.role, invite.createdBy)) {
          throw new AppError(
            'NOT_PERMITTED',
            'Only whoever created the invite, or the owner, can revoke it.',
          );
        }
        await tx
          .update(invites)
          .set({ revokedAt: sql`now()` })
          .where(eq(invites.id, inviteId));
        await recordActivity(tx, {
          groupId: membership.groupId,
          actorId: me,
          verb: 'invite.revoked',
          entityType: 'invite',
          entityId: inviteId,
          targetUser: invite.targetPlaceholder,
        });
      });
    },

    /** GET /invites/:token (public): just enough to decide whether to join. */
    async preview(token: string): Promise<InvitePreview> {
      const { invite, group } = await findLive(db, token);
      const [members, placeholders, [inviter]] = await Promise.all([
        groupsRepo.listMembers(db, group.id),
        claimablePlaceholders(db, group.id),
        db.select({ name: users.name }).from(users).where(eq(users.id, invite.createdBy)),
      ]);
      const target = placeholders.find((p) => p.id === invite.targetPlaceholder);
      return {
        group: {
          name: group.kind === 'direct' ? null : group.name,
          emoji: group.emoji,
          memberCount: members.filter((m) => m.leftAt === null).length,
        },
        invitedBy: { name: inviter?.name ?? 'Someone' },
        // A friendship offers only the friend it was made for.
        placeholders: group.kind === 'direct' ? (target ? [target] : []) : placeholders,
        targetPlaceholderId: target?.id ?? null,
        expired: invite.expiresAt.getTime() <= Date.now(),
      };
    },

    /**
     * POST /invites/:token/accept: claim a placeholder (a merge), or join as a new member.
     * Someone who left is brought back.
     */
    async accept(me: string, token: string, input: AcceptInvite): Promise<AcceptInviteResponse> {
      return withTx(db, async (tx) => {
        const { invite, group } = await findLive(tx, token);
        if (invite.expiresAt.getTime() <= Date.now()) {
          throw new AppError('INVITE_EXPIRED', 'This invite has expired. Ask for a new link.');
        }
        await groupsRepo.lockGroup(tx, group.id);

        if (input.claimPlaceholderId) {
          const placeholders = await claimablePlaceholders(tx, group.id);
          // In a friendship, only the friend the link was made for can be claimed.
          const claimable =
            placeholders.some((p) => p.id === input.claimPlaceholderId) &&
            (group.kind === 'group' || input.claimPlaceholderId === invite.targetPlaceholder);
          if (!claimable) {
            throw new AppError(
              'PLACEHOLDER_UNAVAILABLE',
              'That person has already been claimed or isn’t in this group.',
            );
          }
          const merged = await mergePlaceholder(tx, {
            placeholderId: input.claimPlaceholderId,
            userId: me,
          });
          // A friendship merged into one I already had: go to that one.
          return { groupId: merged.replaced.get(group.id) ?? group.id };
        }

        if (group.kind === 'direct') {
          throw new AppError(
            'CANNOT_MODIFY_DIRECT_GROUP',
            'This link is for the friend it was made for: choose their name to join.',
          );
        }
        const existing = await groupsRepo.findMembership(tx, group.id, me);
        if (existing && existing.leftAt === null) {
          throw new AppError('ALREADY_MEMBER', 'You’re already in this group.');
        }
        if (existing) await groupsRepo.rejoin(tx, group.id, me);
        else await groupsRepo.insertMembers(tx, group.id, [{ userId: me, role: 'member' }]);
        await recordActivity(tx, {
          ...memberAdded(group.id, me, me),
          after: { inviteId: invite.id },
        });
        return { groupId: group.id };
      });
    },
  };
}
