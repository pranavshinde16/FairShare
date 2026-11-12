import type { Group } from '@fairshare/contracts';

/** A group's name; a friendship has none, so it's "You & Rahul" from the viewer's side. */
export function groupTitle(group: Pick<Group, 'kind' | 'name' | 'members'>, meId?: string): string {
  if (group.kind === 'group') return group.name ?? '';
  const other = group.members.find((m) => m.user.id !== meId);
  return other ? `You & ${other.user.name}` : 'Friendship';
}
