// Who may do what in a group (Blueprint 4.2), as pure functions. The service loads the facts,
// asks these, and turns a "no" into the matching error.

import type { NetRow } from '../balances/repo';

export type GroupKind = 'group' | 'direct';
export type Role = 'owner' | 'member';

export type MemberFacts = {
  userId: string;
  role: Role;
  joinedAt: Date;
  leftAt: Date | null;
  isPlaceholder: boolean;
  isDeleted: boolean;
};

/**
 * Friendships are two-person groups with no owner: their members can't be changed, and they can't
 * be renamed, left or deleted (plan correction: direct-group roles). Everything else about them,
 * expenses included, works as in any group.
 */
export const isEditableGroup = (kind: GroupKind) => kind === 'group';

/** Removing someone else, and deleting the group, are the owner's. */
export const isOwner = (role: Role) => role === 'owner';

/** Its creator or the group's owner may revoke an invite. */
export const canRevokeInvite = (actorId: string, role: Role, createdBy: string) =>
  actorId === createdBy || isOwner(role);

/** Whether someone's balance is zero in every currency in this group. */
export const isSettled = (userId: string, nets: NetRow[]) =>
  nets.every((row) => row.userId !== userId);

/** Whether every balance in the group is zero. */
export const isGroupSettled = (nets: NetRow[]) => nets.length === 0;

/**
 * Who becomes owner when the owner leaves: the longest-standing active member with an account
 * (plan correction: never a placeholder, who can't sign in, nor a deleted account). Null when no
 * one with an account remains; then the group is closed, since nobody could see it any more.
 */
export function nextOwner(members: MemberFacts[], leavingId: string): string | null {
  const candidates = members
    .filter((m) => m.userId !== leavingId && m.leftAt === null && !m.isPlaceholder && !m.isDeleted)
    .sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId),
    );
  return candidates[0]?.userId ?? null;
}
