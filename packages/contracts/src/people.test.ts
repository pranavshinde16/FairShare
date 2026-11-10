// Users, groups, members, invites, friends and Home.

import { describe, expect, it } from 'vitest';
import { AddFriendResponse, FriendDetail, FriendList } from './friends';
import { CreateGroup, Group, GroupEmoji, GroupList, NewMember, UpdateGroup } from './groups';
import { Home } from './home';
import { AcceptInvite, CreateInvite, InviteCreated, InvitePreview, InviteToken } from './invites';
import {
  directGroup,
  expectValid,
  group,
  ids,
  rejectedPaths,
  userRef,
  withField,
} from './testing/fixtures';
import { DeleteAccount, Profile, UpdateProfile, UserRef } from './users';

const inr = (amount: number) => ({ amount, currency: 'INR' });

describe('UserRef and Profile', () => {
  it('accept the server’s shape and drop fields this client doesn’t know', () => {
    expect(UserRef.parse({ ...userRef(ids.a, 'Asha'), pronouns: 'she' })).toEqual(
      userRef(ids.a, 'Asha'),
    );
    expectValid(Profile, {
      id: ids.a,
      name: 'Asha',
      email: 'asha@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      defaultCurrency: 'INR',
      upiVpa: null,
      createdAt: '2026-11-01T08:00:00.000Z',
    });
  });
});

describe('UpdateProfile', () => {
  it('accepts any subset of fields', () => {
    expect(expectValid(UpdateProfile, {})).toEqual({});
    expect(expectValid(UpdateProfile, { name: ' Asha K ', defaultCurrency: 'USD' })).toEqual({
      name: 'Asha K',
      defaultCurrency: 'USD',
    });
  });

  it.each(['asha@okaxis', 'asha.k-99@ybl', 'a_b@paytm'])('accepts UPI ID %j', (upiVpa) =>
    expect(UpdateProfile.safeParse({ upiVpa }).success).toBe(true),
  );

  it.each(['asha', 'a@okaxis', 'asha@ok1', 'asha@o', 'asha@@okaxis', 'as ha@okaxis'])(
    'rejects UPI ID %j',
    (upiVpa) => expect(rejectedPaths(UpdateProfile, { upiVpa })).toEqual(['upiVpa']),
  );

  it('clears the UPI ID with null', () =>
    expect(UpdateProfile.parse({ upiVpa: null })).toEqual({ upiVpa: null }));

  it('rejects fields that can’t be edited', () => {
    expect(rejectedPaths(UpdateProfile, { email: 'x@example.com' })).toEqual(['']);
    expect(rejectedPaths(UpdateProfile, { name: '' })).toEqual(['name']);
  });
});

describe('DeleteAccount', () => {
  it('requires the exact confirmation word', () => {
    expectValid(DeleteAccount, { confirm: 'DELETE' });
    expect(DeleteAccount.safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(DeleteAccount.safeParse({}).success).toBe(false);
  });
});

describe('GroupEmoji', () => {
  it.each(['🏖️', '🍕', '👨‍👩‍👧', '🇮🇳', '👍🏽'])('accepts %j', (emoji) =>
    expect(GroupEmoji.safeParse(emoji).success).toBe(true),
  );

  it.each(['🏖️🍕', 'G', ':)', ''])('rejects %j', (emoji) =>
    expect(GroupEmoji.safeParse(emoji).success).toBe(false),
  );
});

describe('NewMember', () => {
  it('is an existing user or a placeholder', () => {
    expectValid(NewMember, { userId: ids.b });
    expectValid(NewMember, { name: 'Dev' });
    expect(NewMember.parse({ name: ' Dev ', email: ' dev@example.com ' })).toEqual({
      name: 'Dev',
      email: 'dev@example.com',
    });
  });

  it('rejects a mix of both, or neither', () => {
    expect(NewMember.safeParse({ userId: ids.b, name: 'Dev' }).success).toBe(false);
    expect(NewMember.safeParse({}).success).toBe(false);
    expect(NewMember.safeParse({ name: 'Dev', email: 'nope' }).success).toBe(false);
  });
});

describe('CreateGroup', () => {
  const body = {
    id: ids.group,
    name: 'Goa Trip',
    emoji: '🏖️',
    currency: 'INR',
    members: [{ userId: ids.b }, { name: 'Chitra' }, { name: 'Dev', email: 'dev@example.com' }],
  };

  it('accepts a group with initial members, or with only the required fields', () => {
    expectValid(CreateGroup, body);
    expectValid(CreateGroup, { id: ids.group, name: 'Flat', currency: 'INR' });
  });

  it.each([
    [{ name: '  ' }, 'name'],
    [{ name: 'x'.repeat(61) }, 'name'],
    [{ currency: 'inr' }, 'currency'],
    [{ id: 'g1' }, 'id'],
    [{ emoji: 'GT' }, 'emoji'],
    [{ members: Array.from({ length: 51 }, () => ({ name: 'P' })) }, 'members'],
    [{ kind: 'direct' }, ''],
  ])('rejects %j', (patch, path) =>
    expect(rejectedPaths(CreateGroup, withField(body, patch))).toContain(path),
  );
});

describe('UpdateGroup', () => {
  it('accepts partial updates, and null to remove the emoji', () => {
    expectValid(UpdateGroup, { name: 'Goa 2026' });
    expect(UpdateGroup.parse({ emoji: null })).toEqual({ emoji: null });
  });

  it('rejects changing the kind', () =>
    expect(UpdateGroup.safeParse({ kind: 'direct' }).success).toBe(false));
});

describe('Group', () => {
  it('accepts regular and direct groups', () => {
    expect(expectValid(Group, group).kind).toBe('group');
    expect(expectValid(Group, directGroup).kind).toBe('direct');
  });

  it('rejects a regular group without a name and a direct group with one', () => {
    expect(rejectedPaths(Group, withField(group, { name: null }))).toEqual(['name']);
    expect(rejectedPaths(Group, withField(directGroup, { name: 'You & Bilal' }))).toEqual(['name']);
  });

  it('lists only regular groups, each with my net', () => {
    expectValid(GroupList, { items: [{ ...group, myNet: [inr(185_000)] }] });
    expect(GroupList.safeParse({ items: [{ ...directGroup, myNet: [] }] }).success).toBe(false);
  });
});

describe('invites', () => {
  it('accepts targeted and untargeted invites', () => {
    expectValid(CreateInvite, {});
    expectValid(CreateInvite, { targetPlaceholderId: ids.d });
    expect(CreateInvite.safeParse({ targetPlaceholderId: 'Dev' }).success).toBe(false);
  });

  it('returns a link that expires', () => {
    expectValid(InviteCreated, {
      id: ids.invite,
      url: 'https://fairshare.app/invite/abc',
      expiresAt: '2026-12-05T10:00:00.000Z',
    });
    expect(
      InviteCreated.safeParse({ id: ids.invite, url: 'not a url', expiresAt: '2026-12-05' })
        .success,
    ).toBe(false);
  });

  it('accepts only 32-byte base64url tokens', () => {
    expect(InviteToken.safeParse('A'.repeat(43)).success).toBe(true);
    expect(InviteToken.safeParse('A'.repeat(42)).success).toBe(false);
    expect(InviteToken.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('previews the group for someone deciding whether to join', () => {
    expectValid(InvitePreview, {
      group: { name: 'Goa Trip', emoji: '🏖️', memberCount: 4 },
      invitedBy: { name: 'Asha' },
      placeholders: [{ id: ids.d, name: 'Dev' }],
      targetPlaceholderId: ids.d,
      expired: false,
    });
  });

  it('accepts joining as new or claiming a placeholder', () => {
    expectValid(AcceptInvite, {});
    expectValid(AcceptInvite, { claimPlaceholderId: ids.d });
    expect(AcceptInvite.safeParse({ claimPlaceholderId: ids.d, extra: 1 }).success).toBe(false);
  });
});

describe('friends', () => {
  const friend = { user: userRef(ids.b, 'Bilal'), balances: [inr(-95_000)], directGroupId: null };

  it('accepts the friend list, including people without a direct group', () => {
    expectValid(FriendList, { items: [friend, { ...friend, directGroupId: ids.direct }] });
    expectValid(AddFriendResponse, { groupId: ids.direct, friend: userRef(ids.b, 'Bilal') });
  });

  it('breaks a friend’s balance down by group', () => {
    expectValid(FriendDetail, {
      user: userRef(ids.b, 'Bilal'),
      directGroupId: ids.direct,
      total: [inr(-95_000)],
      breakdown: [
        { groupId: ids.group, groupName: 'Goa Trip', kind: 'group', balance: inr(-95_000) },
        { groupId: ids.direct, groupName: null, kind: 'direct', balance: inr(0) },
      ],
    });
  });

  it('builds Home from the same pieces', () => {
    expectValid(Home, {
      totals: [{ currency: 'INR', owed: 185_000, owe: 0 }],
      groups: [{ group, myNet: [inr(185_000)], lastActivityAt: '2026-11-06T09:00:00.000Z' }],
      people: [friend],
    });
    expect(
      Home.safeParse({ totals: [{ currency: 'INR', owed: -1, owe: 0 }], groups: [], people: [] })
        .success,
    ).toBe(false);
  });
});
