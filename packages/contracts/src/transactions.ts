import { z } from 'zod';
import { page, PageQuery } from './pagination';
import {
  Amount,
  CurrencyCode,
  IsoDate,
  Line,
  OccurredOn,
  SignedAmount,
  Timestamp,
  Uuid,
  Version,
} from './primitives';
import { MAX_PEOPLE_PER_TRANSACTION, SplitInput, SplitMethod } from './split';
import { UserRef } from './users';

export const TransactionType = z.enum(['expense', 'settlement']);
export type TransactionType = z.infer<typeof TransactionType>;

export const PaymentMethod = z.enum(['cash', 'upi', 'bank_transfer', 'other']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const Description = z.string().trim().min(1).max(120);

/** Free text. An empty string is stored as NULL. */
export const Notes = z.string().trim().max(1000);

// ---- expenses -----------------------------------------------------------------------------------

/**
 * POST /groups/:groupId/expenses. zod checks shape and per-field ranges; core checks sums,
 * duplicate payers and participants; the service checks membership, the group's currency and
 * `occurredOn <= latestOccurredOn(today)`.
 */
export const CreateExpense = z.strictObject({
  id: Uuid,
  description: Description,
  amount: Amount,
  currency: CurrencyCode,
  occurredOn: OccurredOn,
  notes: Notes.optional(),
  payers: z.array(Line).min(1).max(MAX_PEOPLE_PER_TRANSACTION),
  split: SplitInput,
  /** Set when the draft came from AI parsing, linking the saved expense to that request. */
  aiRequestId: z.int().min(1).optional(),
});
export type CreateExpense = z.infer<typeof CreateExpense>;

/** PUT /transactions/:id for an expense (with If-Match): the full expense, without the id. */
export const UpdateExpense = CreateExpense.omit({ id: true });
export type UpdateExpense = z.infer<typeof UpdateExpense>;

// ---- settlements --------------------------------------------------------------------------------

/** A payment reference such as a UPI transaction ID. */
export const PaymentReference = z.string().trim().min(1).max(100);

/**
 * POST /groups/:groupId/settlements: "from paid to". It's stored as a transaction with one payer
 * (from) and one share (to); see settlementColumns for how the other fields map.
 */
export const CreateSettlement = z.strictObject({
  id: Uuid,
  fromUserId: Uuid,
  toUserId: Uuid,
  amount: Amount,
  currency: CurrencyCode,
  occurredOn: OccurredOn,
  method: PaymentMethod,
  reference: PaymentReference.optional(),
  note: Notes.optional(),
});
export type CreateSettlement = z.infer<typeof CreateSettlement>;

/** PUT /transactions/:id for a settlement (with If-Match): the full settlement, without the id. */
export const UpdateSettlement = CreateSettlement.omit({ id: true });
export type UpdateSettlement = z.infer<typeof UpdateSettlement>;

/**
 * The stored description of every settlement. It's fixed rather than "Rahul paid Amit" because
 * names change (a placeholder gets claimed, someone renames themselves); the UI builds the
 * sentence from the payer and share instead.
 */
export const SETTLEMENT_DESCRIPTION = 'Settlement';

/**
 * How a settlement request maps onto transaction columns. The payer and share rows come from
 * core's settlementLines, which also rejects paying yourself.
 */
export function settlementColumns(input: UpdateSettlement) {
  return {
    description: SETTLEMENT_DESCRIPTION,
    notes: input.note || null,
    paymentMethod: input.method,
    paymentRef: input.reference ?? null,
  };
}

/** The reverse of settlementColumns: a stored settlement as the body that would recreate it. */
export function settlementInput(tx: SettlementTransaction): UpdateSettlement {
  return {
    fromUserId: tx.payers[0].userId,
    toUserId: tx.shares[0].userId,
    amount: tx.amount,
    currency: tx.currency,
    occurredOn: tx.occurredOn,
    method: tx.paymentMethod,
    ...(tx.paymentRef !== null && { reference: tx.paymentRef }),
    ...(tx.notes !== null && { note: tx.notes }),
  };
}

// ---- reading transactions -----------------------------------------------------------------------

const transactionFields = {
  id: Uuid,
  groupId: Uuid,
  description: z.string(),
  notes: z.string().nullable(),
  amount: Amount,
  currency: CurrencyCode,
  occurredOn: IsoDate,
  createdBy: UserRef,
  updatedBy: UserRef.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp.nullable(),
  deletedAt: Timestamp.nullable(),
  version: Version,
  /** This transaction's effect on the caller's balance: paid − share. */
  myNet: SignedAmount,
};

export const ExpenseTransaction = z.object({
  ...transactionFields,
  type: z.literal('expense'),
  splitMethod: SplitMethod,
  splitInput: SplitInput.nullable(),
  payers: z.array(Line).min(1),
  shares: z.array(Line).min(1),
  paymentMethod: z.null(),
  paymentRef: z.null(),
});
export type ExpenseTransaction = z.infer<typeof ExpenseTransaction>;

/** A settlement has exactly one payer and one share for the same amount (I9). */
export const SettlementTransaction = z.object({
  ...transactionFields,
  type: z.literal('settlement'),
  splitMethod: z.null(),
  splitInput: z.null(),
  payers: z.tuple([Line]),
  shares: z.tuple([Line]),
  paymentMethod: PaymentMethod,
  paymentRef: z.string().nullable(),
});
export type SettlementTransaction = z.infer<typeof SettlementTransaction>;

/** GET /transactions/:id, and the response to create, update and restore. */
export const Transaction = z.discriminatedUnion('type', [
  ExpenseTransaction,
  SettlementTransaction,
]);
export type Transaction = z.infer<typeof Transaction>;

/** GET /groups/:groupId/transactions query parameters. */
export const TransactionListQuery = PageQuery.extend({
  /** Matches description and notes (trigram search). */
  q: z.string().trim().min(2).max(100).optional(),
  /** Only transactions this person paid for or shares in. */
  person: Uuid.optional(),
  type: TransactionType.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  includeDeleted: z.stringbool({ truthy: ['true'], falsy: ['false'] }).optional(),
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: '"from" must not be after "to"',
  path: ['to'],
});
export type TransactionListQuery = z.infer<typeof TransactionListQuery>;

export const TransactionPage = page(Transaction);
export type TransactionPage = z.infer<typeof TransactionPage>;

/** DELETE /transactions/:id (soft delete). */
export const DeletedTransaction = z.object({ id: Uuid, version: Version, deletedAt: Timestamp });
export type DeletedTransaction = z.infer<typeof DeletedTransaction>;
