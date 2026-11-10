import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, currencyCode, timestamptz } from './columns';
import { currencies, users } from './users';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** A group of people sharing expenses. A friendship is a group with kind = 'direct'. */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: ['group', 'direct'] }).notNull(),
    /** Null for direct groups: the UI derives "You & Rahul". */
    name: text('name'),
    emoji: text('emoji'),
    currency: currencyCode('currency')
      .notNull()
      .references(() => currencies.code),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    check('groups_kind', sql`${t.kind} IN ('group', 'direct')`),
    // The plan's `kind = 'direct' OR length(name) BETWEEN 1 AND 60` lets a regular group have a
    // NULL name: length(NULL) is NULL, and a CHECK only fails on FALSE. Hence the explicit IS NOT NULL.
    check(
      'groups_name',
      sql`(${t.kind} = 'direct' AND ${t.name} IS NULL) OR (${t.kind} = 'group' AND ${t.name} IS NOT NULL AND length(${t.name}) BETWEEN 1 AND 60)`,
    ),
  ],
);

/** Membership is the authorization primitive. Leaving sets left_at; the row stays for history. */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    leftAt: timestamptz('left_at'),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    check('group_members_role', sql`${t.role} IN ('owner', 'member')`),
    check(
      'group_members_left_after_joined',
      sql`${t.leftAt} IS NULL OR ${t.leftAt} >= ${t.joinedAt}`,
    ),
    index('group_members_user_active_idx')
      .on(t.userId)
      .where(sql`${t.leftAt} IS NULL`),
    uniqueIndex('group_members_one_owner')
      .on(t.groupId)
      .where(sql`${t.role} = 'owner' AND ${t.leftAt} IS NULL`),
  ],
);

/** At most one direct group per pair of people, stored in sorted order. */
export const directPairs = pgTable(
  'direct_pairs',
  {
    userLow: uuid('user_low')
      .notNull()
      .references(() => users.id),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => users.id),
    groupId: uuid('group_id')
      .notNull()
      .unique()
      .references(() => groups.id),
  },
  (t) => [
    primaryKey({ columns: [t.userLow, t.userHigh] }),
    check('direct_pairs_sorted', sql`${t.userLow} < ${t.userHigh}`),
  ],
);

/** Multi-use invite links. Only the SHA-256 of the token is stored. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    tokenHash: bytea('token_hash').notNull().unique(),
    targetPlaceholder: uuid('target_placeholder').references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('invites_token_hash_length', sql`octet_length(${t.tokenHash}) = 32`),
    index('invites_group_active_idx')
      .on(t.groupId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
