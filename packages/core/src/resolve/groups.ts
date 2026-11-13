import type { UserId } from '../types';
import { isSelf, resolveName, type NameCandidate } from './resolve';

/** A group the person typing is in, as candidates for where an expense belongs. */
export type GroupCandidate = {
  id: string;
  kind: 'group' | 'direct';
  /** Its active members, the person typing included. */
  members: readonly NameCandidate[];
  /** ISO timestamp of its latest activity: ties go to the most recent. */
  lastActivityAt: string;
};

/**
 * Which group a typed expense is for, when it was typed outside any group (Blueprint 8.6 "Group
 * selection"):
 *
 * - Each group scores one point per mentioned name that resolves to exactly one of its members.
 * - Exactly one other person mentioned, and a friendship with that person: the friendship.
 * - Otherwise the highest score; ties, and no names at all, go to the most recently active group
 *   (regular groups before friendships when nobody is named).
 *
 * Null only when there is no group at all.
 */
export function chooseGroup(
  names: readonly string[],
  groups: readonly GroupCandidate[],
  meId: UserId,
): string | null {
  if (groups.length === 0) return null;
  const others = names.filter((n) => !isSelf(n));
  const resolvesIn = (group: GroupCandidate, name: string) => {
    const r = resolveName(name, group.members, meId);
    return r.status === 'resolved' && r.userId !== meId;
  };

  if (others.length === 1) {
    const direct = groups.find((g) => g.kind === 'direct' && resolvesIn(g, others[0]!));
    if (direct) return direct.id;
  }

  const ranked = groups
    .map((group) => ({
      group,
      score: others.filter((name) => resolvesIn(group, name)).length,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // With nobody named, a regular group is the likelier home for an expense.
        (others.length === 0 ? kindRank(a.group) - kindRank(b.group) : 0) ||
        compare(b.group.lastActivityAt, a.group.lastActivityAt) ||
        // Still level: any fixed order, so the same input always picks the same group.
        compare(a.group.id, b.group.id),
    );
  return ranked[0]!.group.id;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const kindRank = (group: GroupCandidate) => (group.kind === 'group' ? 0 : 1);
