import { z } from 'zod';
import { page, PageQuery } from './pagination';
import { Amount, CurrencyCode, IsoDate, Line, Timestamp, Uuid } from './primitives';
import { SplitInput, SplitMethod } from './split';
import { PaymentMethod } from './transactions';
import { UserRef } from './users';

export const ACTIVITY_VERBS = [
  'group.created',
  'group.renamed',
  'group.updated', // emoji or currency changed
  'group.deleted',
  'member.added',
  'member.removed',
  'member.left',
  'member.claimed',
  'invite.created',
  'invite.revoked',
  'transaction.created',
  'transaction.updated',
  'transaction.deleted',
  'transaction.restored',
] as const;

export const ActivityVerb = z.enum(ACTIVITY_VERBS);
export type ActivityVerb = z.infer<typeof ActivityVerb>;

export const EntityType = z.enum(['group', 'member', 'invite', 'transaction']);
export type EntityType = z.infer<typeof EntityType>;

/**
 * A transaction's before/after in the activity log (core's TransactionSnapshot). The web app
 * parses entry.before and entry.after with this, then passes them to core's diffSnapshots.
 */
export const TransactionSnapshot = z.object({
  description: z.string(),
  amount: Amount,
  currency: CurrencyCode,
  occurredOn: IsoDate,
  notes: z.string().nullable(),
  splitMethod: SplitMethod.nullable(),
  splitInput: SplitInput.nullable(),
  payers: z.array(Line),
  shares: z.array(Line),
  /** Settlements only; expenses leave both out. */
  paymentMethod: PaymentMethod.optional(),
  paymentRef: z.string().nullable().optional(),
});
export type TransactionSnapshot = z.infer<typeof TransactionSnapshot>;

const Snapshot = z.record(z.string(), z.unknown()).nullable();

export const ActivityEntry = z.object({
  id: z.int().min(1),
  groupId: Uuid,
  groupName: z.string().nullable(), // null for a direct group
  actor: UserRef,
  verb: ActivityVerb,
  entityType: EntityType,
  entityId: Uuid,
  target: UserRef.nullable(),
  before: Snapshot,
  after: Snapshot,
  createdAt: Timestamp,
  /** I paid for or share in the transaction, or I'm the target. The feed emphasizes these. */
  involvesMe: z.boolean(),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/** GET /activity and GET /groups/:groupId/activity query parameters. */
export const ActivityListQuery = PageQuery;
export type ActivityListQuery = z.infer<typeof ActivityListQuery>;

/**
 * GET /activity and GET /groups/:groupId/activity, newest first.
 *
 * - unreadCount: entries in this feed that someone else made after I last opened Activity
 *   (POST /activity/seen). For the group feed, those in that group.
 * - people: everyone the page's before/after snapshots name (payers, recipients, people in a
 *   split), so the feed can say "Bilal paid you" without loading each group.
 */
export const ActivityFeed = page(ActivityEntry).extend({
  unreadCount: z.int().min(0),
  people: z.array(UserRef),
});
export type ActivityFeed = z.infer<typeof ActivityFeed>;

/** GET /transactions/:id/history. */
export const TransactionHistory = z.object({ items: z.array(ActivityEntry) });
export type TransactionHistory = z.infer<typeof TransactionHistory>;
