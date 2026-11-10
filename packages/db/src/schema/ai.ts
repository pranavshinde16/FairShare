import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from './columns';
import { users } from './users';

/** One row per AI parse request, for rate limits, cost tracking and quality review. */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** 'parse_expense' now; 'receipt' later. */
    kind: text('kind').notNull(),
    path: text('path', { enum: ['rules', 'llm', 'fallback'] }).notNull(),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    /** Purged after 30 days. */
    inputText: text('input_text'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    latencyMs: integer('latency_ms'),
    outcome: text('outcome', {
      enum: ['ok', 'invalid_output', 'timeout', 'error', 'rate_limited'],
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('ai_requests_path', sql`${t.path} IN ('rules', 'llm', 'fallback')`),
    check(
      'ai_requests_outcome',
      sql`${t.outcome} IN ('ok', 'invalid_output', 'timeout', 'error', 'rate_limited')`,
    ),
    check(
      'ai_requests_usage_non_negative',
      sql`${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0 AND ${t.costMicros} >= 0 AND ${t.latencyMs} >= 0`,
    ),
    index('ai_requests_user_created_idx').on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);
