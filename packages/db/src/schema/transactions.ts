import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiRequests } from './ai';
import { createdAt, currencyCode, money, timestamptz } from './columns';
import { groups } from './groups';
import { currencies, users } from './users';

/**
 * Expenses and settlements. A settlement is one payer (who handed over the money) and one share
 * (who received it), so both use one ledger and one edit/delete/restore path.
 *
 * The sums (payers = shares = amount) and the settlement shape are checked at COMMIT by deferred
 * triggers (migration 0002), because they span several rows.
 */
export const transactions = pgTable(
  'transactions',
  {
    /** Client-generated UUIDv7, which makes creates idempotent. */
    id: uuid('id').primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    type: text('type', { enum: ['expense', 'settlement'] }).notNull(),
    description: text('description').notNull(),
    notes: text('notes'),
    currency: currencyCode('currency')
      .notNull()
      .references(() => currencies.code),
    amount: money('amount').notNull(),
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    splitMethod: text('split_method', { enum: ['equal', 'exact', 'percent', 'shares'] }),
    /** What the user entered, so the editor reopens exactly as they left it. */
    splitInput: jsonb('split_input'),
    paymentMethod: text('payment_method', { enum: ['cash', 'upi', 'bank_transfer', 'other'] }),
    paymentRef: text('payment_ref'),
    source: text('source', { enum: ['manual', 'ai_text', 'import'] })
      .notNull()
      .default('manual'),
    aiRequestId: bigint('ai_request_id', { mode: 'number' }).references(() => aiRequests.id),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    deletedBy: uuid('deleted_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    check('transactions_type', sql`${t.type} IN ('expense', 'settlement')`),
    check('transactions_description_length', sql`length(${t.description}) BETWEEN 1 AND 120`),
    check('transactions_notes_length', sql`length(${t.notes}) <= 1000`),
    // 10¹⁰ is core's MAX_AMOUNT_MINOR; a DDL CHECK can't take it as a parameter.
    check('transactions_amount_range', sql`${t.amount} > 0 AND ${t.amount} <= 10000000000`),
    check('transactions_occurred_on_min', sql`${t.occurredOn} >= '2000-01-01'`),
    check(
      'transactions_split_method',
      sql`${t.splitMethod} IN ('equal', 'exact', 'percent', 'shares')`,
    ),
    check(
      'transactions_payment_method',
      sql`${t.paymentMethod} IN ('cash', 'upi', 'bank_transfer', 'other')`,
    ),
    check('transactions_source', sql`${t.source} IN ('manual', 'ai_text', 'import')`),
    check('transactions_version_positive', sql`${t.version} >= 1`),
    // Expenses have a split and no payment details; settlements the reverse.
    check(
      'transactions_type_fields',
      sql`(${t.type} = 'expense' AND ${t.splitMethod} IS NOT NULL AND ${t.paymentMethod} IS NULL AND ${t.paymentRef} IS NULL)
       OR (${t.type} = 'settlement' AND ${t.splitMethod} IS NULL AND ${t.splitInput} IS NULL AND ${t.paymentMethod} IS NOT NULL)`,
    ),
    check('transactions_deleted_fields', sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
    index('tx_group_feed')
      .on(t.groupId, t.occurredOn.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`${t.deletedAt} IS NULL`),
    index('tx_group_all').on(t.groupId, t.occurredOn.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index('tx_search').using(
      'gin',
      sql`(${t.description} || ' ' || coalesce(${t.notes}, '')) gin_trgm_ops`,
    ),
  ],
);

const lineColumns = {
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  amount: money('amount').notNull(),
};

/** Who paid how much. Σ amount = transactions.amount. */
export const transactionPayers = pgTable('transaction_payers', lineColumns, (t) => [
  primaryKey({ columns: [t.transactionId, t.userId] }),
  check('transaction_payers_amount_positive', sql`${t.amount} > 0`),
  index('transaction_payers_user_idx').on(t.userId),
]);

/** Who consumed how much. Σ amount = transactions.amount. Zero shares aren't stored. */
export const transactionShares = pgTable('transaction_shares', lineColumns, (t) => [
  primaryKey({ columns: [t.transactionId, t.userId] }),
  check('transaction_shares_amount_positive', sql`${t.amount} > 0`),
  index('transaction_shares_user_idx').on(t.userId),
]);

/**
 * paid − share per user and transaction, excluding deleted transactions. Balances are sums over
 * this view; nothing derived is ever stored. Defined in migration 0002.
 */
export const ledger = pgView('ledger', {
  transactionId: uuid('transaction_id').notNull(),
  groupId: uuid('group_id').notNull(),
  currency: currencyCode('currency').notNull(),
  userId: uuid('user_id').notNull(),
  amount: money('amount').notNull(),
}).existing();
