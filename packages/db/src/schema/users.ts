import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { auth_user } from './auth';
import { citext, createdAt, currencyCode, timestamptz } from './columns';

/** ISO 4217 reference data, seeded. Core receives minor_units as an argument; it never reads this. */
export const currencies = pgTable(
  'currencies',
  {
    code: currencyCode('code').primaryKey(),
    minorUnits: smallint('minor_units').notNull(),
    symbol: text('symbol').notNull(),
  },
  (t) => [
    check('currencies_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
    // core's money parsing and formatting support 0–4 decimal places.
    check('currencies_minor_units_range', sql`${t.minorUnits} BETWEEN 0 AND 4`),
  ],
);

/**
 * Domain identity for real people and placeholders. They share one table so either can pay or
 * share in any transaction. auth_user_id is null for placeholders and deleted accounts.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    authUserId: text('auth_user_id')
      .unique()
      .references(() => auth_user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** The auth email for real users; an optional hint for placeholders. */
    email: citext('email'),
    avatarUrl: text('avatar_url'),
    defaultCurrency: currencyCode('default_currency')
      .notNull()
      .default('INR')
      .references(() => currencies.code),
    upiVpa: text('upi_vpa'),
    isPlaceholder: boolean('is_placeholder').notNull().default(false),
    createdBy: uuid('created_by').references((): AnyPgColumn => users.id),
    /** Set when a placeholder is claimed; old references resolve through it. */
    mergedInto: uuid('merged_into').references((): AnyPgColumn => users.id),
    activitySeenAt: timestamptz('activity_seen_at'),
    createdAt: createdAt(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    check('users_name_length', sql`length(${t.name}) BETWEEN 1 AND 60`),
    check('users_placeholder_has_no_auth', sql`NOT ${t.isPlaceholder} OR ${t.authUserId} IS NULL`),
    check('users_not_merged_into_self', sql`${t.mergedInto} IS DISTINCT FROM ${t.id}`),
    index('users_email_idx')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL AND NOT ${t.isPlaceholder}`),
  ],
);
