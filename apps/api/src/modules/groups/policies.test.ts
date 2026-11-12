import { describe, expect, it } from 'vitest';
import {
  canRevokeInvite,
  isEditableGroup,
  isGroupSettled,
  isOwner,
  isSettled,
  nextOwner,
  type MemberFacts,
} from './policies';

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const member = (userId: string, day: number, extra: Partial<MemberFacts> = {}): MemberFacts => ({
  userId,
  role: 'member',
  joinedAt: at(day),
  leftAt: null,
  isPlaceholder: false,
  ...extra,
});
const net = (userId: string, amount: number) => ({
  groupId: 'g',
  userId,
  currency: 'INR',
  net: amount,
});

describe('nextOwner', () => {
  it('picks the longest-standing active member with an account', () => {
    const members = [
      member('owner', 1, { role: 'owner' }),
      member('placeholder', 2, { isPlaceholder: true }),
      member('gone', 3, { leftAt: at(4) }),
      member('later', 6),
      member('earlier', 5),
    ];
    expect(nextOwner(members, 'owner')).toBe('earlier');
  });

  it('breaks a tie on the join time by user ID, so the choice is stable', () => {
    expect(nextOwner([member('o', 1), member('b', 2), member('a', 2)], 'o')).toBe('a');
  });

  it('returns null when only placeholders and former members remain', () => {
    const members = [
      member('owner', 1),
      member('p', 2, { isPlaceholder: true }),
      member('x', 3, { leftAt: at(4) }),
    ];
    expect(nextOwner(members, 'owner')).toBeNull();
  });
});

describe('balances', () => {
  it('a person is settled when they have no non-zero net', () => {
    const nets = [net('a', 500), net('b', -500)];
    expect(isSettled('a', nets)).toBe(false);
    expect(isSettled('c', nets)).toBe(true);
    expect(isGroupSettled(nets)).toBe(false);
    expect(isGroupSettled([])).toBe(true);
  });
});

describe('roles and kinds', () => {
  it('lets only regular groups be edited, and only owners act as owners', () => {
    expect(isEditableGroup('group')).toBe(true);
    expect(isEditableGroup('direct')).toBe(false);
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('member')).toBe(false);
  });

  it('lets an invite’s creator or the owner revoke it', () => {
    expect(canRevokeInvite('me', 'member', 'me')).toBe(true);
    expect(canRevokeInvite('me', 'owner', 'someone')).toBe(true);
    expect(canRevokeInvite('me', 'member', 'someone')).toBe(false);
  });
});
