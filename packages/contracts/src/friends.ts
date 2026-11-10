import { z } from 'zod';
import { GroupKind, NewMember } from './groups';
import { Money, Uuid } from './primitives';
import { UserRef } from './users';

/** POST /friends: finds or creates the direct group with this person. */
export const AddFriend = NewMember;
export type AddFriend = NewMember;

/** 200 if the friendship already existed, 201 if it was created. */
export const AddFriendResponse = z.object({ groupId: Uuid, friend: UserRef });
export type AddFriendResponse = z.infer<typeof AddFriendResponse>;

/**
 * A person in my friend list. Positive balances mean they owe me. directGroupId is null for
 * someone I only share regular groups with.
 */
export const Friend = z.object({
  user: UserRef,
  balances: z.array(Money),
  directGroupId: Uuid.nullable(),
});
export type Friend = z.infer<typeof Friend>;

/** GET /friends. */
export const FriendList = z.object({ items: z.array(Friend) });
export type FriendList = z.infer<typeof FriendList>;

/** GET /friends/:userId: what we owe each other overall and in each shared group. */
export const FriendDetail = z.object({
  user: UserRef,
  directGroupId: Uuid.nullable(),
  total: z.array(Money),
  breakdown: z.array(
    z.object({
      groupId: Uuid,
      groupName: z.string().nullable(), // null for our direct group
      kind: GroupKind,
      balance: Money,
    }),
  ),
});
export type FriendDetail = z.infer<typeof FriendDetail>;
