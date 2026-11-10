import { z } from 'zod';
import { CurrencyCode, Email, Money, PersonName, Timestamp, Uuid } from './primitives';
import { UserRef } from './users';

export const GroupKind = z.enum(['group', 'direct']);
export type GroupKind = z.infer<typeof GroupKind>;

export const MemberRole = z.enum(['owner', 'member']);
export type MemberRole = z.infer<typeof MemberRole>;

/** Most people a group can be created with in one request. */
export const MAX_INITIAL_MEMBERS = 50;

export const GroupName = z.string().trim().min(1).max(60);

const graphemes = new Intl.Segmenter();

/** Exactly one emoji, including sequences such as 👨‍👩‍👧 or 🇮🇳. */
export const GroupEmoji = z
  .emoji()
  .max(32)
  .refine((value) => [...graphemes.segment(value)].length === 1, { message: 'Use a single emoji' });

/**
 * Someone to add to a group (or as a friend): an existing user, or a new placeholder. With an
 * email, the server links an existing account or keeps the email as a hint; the response looks the
 * same either way, so the endpoint can't reveal who has an account.
 */
export const NewMember = z.union([
  z.strictObject({ userId: Uuid }),
  z.strictObject({ name: PersonName, email: Email.optional() }),
]);
export type NewMember = z.infer<typeof NewMember>;

/** POST /groups. The creator becomes the owner. */
export const CreateGroup = z.strictObject({
  id: Uuid,
  name: GroupName,
  emoji: GroupEmoji.optional(),
  currency: CurrencyCode,
  members: z.array(NewMember).max(MAX_INITIAL_MEMBERS).optional(),
});
export type CreateGroup = z.infer<typeof CreateGroup>;

/** PATCH /groups/:groupId. `emoji: null` removes the emoji. */
export const UpdateGroup = z.strictObject({
  name: GroupName.optional(),
  emoji: GroupEmoji.nullable().optional(),
  currency: CurrencyCode.optional(),
});
export type UpdateGroup = z.infer<typeof UpdateGroup>;

/** POST /groups/:groupId/members. */
export const AddMember = NewMember;
export type AddMember = NewMember;

/** Members who left keep their row with leftAt set, so history still shows their name. */
export const Member = z.object({
  user: UserRef,
  role: MemberRole,
  joinedAt: Timestamp,
  leftAt: Timestamp.nullable(),
});
export type Member = z.infer<typeof Member>;

const groupFields = {
  id: Uuid,
  emoji: z.string().nullable(),
  currency: CurrencyCode,
  createdAt: Timestamp,
  members: z.array(Member),
  myRole: MemberRole,
};

/** A named group of people sharing expenses. */
export const RegularGroup = z.object({
  kind: z.literal('group'),
  name: z.string(),
  ...groupFields,
});

/**
 * A friendship: a two-person group with no stored name. The UI derives "You & Rahul" from the
 * members, since the wording depends on who is looking.
 */
export const DirectGroup = z.object({ kind: z.literal('direct'), name: z.null(), ...groupFields });

/** GET /groups/:groupId, and the response to create and update. */
export const Group = z.discriminatedUnion('kind', [RegularGroup, DirectGroup]);
export type Group = z.infer<typeof Group>;

/** GET /groups lists only regular groups (friends are under /friends), each with my net per currency. */
export const GroupList = z.object({
  items: z.array(RegularGroup.extend({ myNet: z.array(Money) })),
});
export type GroupList = z.infer<typeof GroupList>;
