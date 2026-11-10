import { sql } from 'drizzle-orm';
import { bigserial, check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './columns';
import { groups } from './groups';
import { users } from './users';

/**
 * Append-only history of every change, written in the same database transaction as the change.
 * UPDATE, DELETE and TRUNCATE are rejected by a trigger and by grants (migration 0003).
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    /** e.g. 'transaction.updated'. The list lives in contracts (ACTIVITY_VERBS). */
    verb: text('verb').notNull(),
    entityType: text('entity_type', {
      enum: ['group', 'member', 'invite', 'transaction'],
    }).notNull(),
    entityId: uuid('entity_id').notNull(),
    targetUser: uuid('target_user').references(() => users.id),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'activity_log_entity_type',
      sql`${t.entityType} IN ('group', 'member', 'invite', 'transaction')`,
    ),
    check('activity_log_verb_format', sql`${t.verb} ~ '^[a-z]+\\.[a-z]+$'`),
    index('activity_log_group_idx').on(t.groupId, t.id.desc().nullsFirst()),
    index('activity_log_entity_idx').on(t.entityId, t.id.desc().nullsFirst()),
  ],
);
