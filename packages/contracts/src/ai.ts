import { z } from 'zod';
import { IsoDate, Uuid } from './primitives';
import { CreateExpense } from './transactions';
import { UserRef } from './users';

// ---- what the LLM returns ------------------------------------------------------------------------

/**
 * The structured output requested from the LLM. The model only extracts what the text says: every
 * number stays a string for core's parseMoney/parsePercent, and names are matched to members by
 * deterministic code, never by the model. Descriptions end up in the JSON Schema the model sees.
 */
export const LlmExpenseExtraction = z.strictObject({
  amount: z
    .string()
    .max(40)
    .nullable()
    .describe('The total exactly as written, e.g. "2400", "2,400.50" or "2.4k". Null if absent.'),
  currency: z
    .string()
    .length(3)
    .nullable()
    .describe('ISO 4217 code if the text names a currency, e.g. "INR". Null otherwise.'),
  description: z
    .string()
    .max(120)
    .nullable()
    .describe('A short title for the expense, e.g. "Dinner". Null if unclear.'),
  date: z
    .string()
    .max(10)
    .nullable()
    .describe('The date as YYYY-MM-DD, resolved relative to today. Null if not mentioned.'),
  payer: z
    .strictObject({
      kind: z.enum(['me', 'person', 'unknown']),
      name: z.string().max(100).nullable().describe('The payer’s name when kind is "person".'),
    })
    .describe('Who paid. "me" means the user writing the text.'),
  people: z
    .array(
      z.strictObject({
        name: z.string().max(100),
        isMe: z.boolean().describe('True when this refers to the user writing the text.'),
      }),
    )
    .max(50)
    .describe('Everyone mentioned as sharing the expense.'),
  includesEveryone: z
    .boolean()
    .describe('True when the text says to split among everyone in the group.'),
  split: z.strictObject({
    method: z.enum(['equal', 'exact', 'percent', 'shares']),
    values: z
      .array(z.strictObject({ name: z.string().max(100), value: z.string().max(40) }))
      .max(50)
      .nullable()
      .describe('Per-person amounts, percentages or shares exactly as written. Null for equal.'),
  }),
  category: z.string().max(60).nullable().describe('A spending category if obvious, e.g. "Food".'),
  notes: z.string().max(1000).nullable().describe('Anything relevant that fits no other field.'),
});
export type LlmExpenseExtraction = z.infer<typeof LlmExpenseExtraction>;

/** LlmExpenseExtraction as JSON Schema, passed to the provider as the structured-output schema. */
export function llmExpenseExtractionJsonSchema() {
  return z.toJSONSchema(LlmExpenseExtraction, { target: 'draft-2020-12' });
}

// ---- POST /ai/parse-expense ---------------------------------------------------------------------

export const ParseExpenseRequest = z.strictObject({
  text: z.string().trim().min(3).max(500),
  /** Omitted when the user is on Home; the server then picks the group from the names. */
  groupId: Uuid.optional(),
  /** Today in the user's time zone, so "yesterday" resolves correctly. */
  today: IsoDate,
});
export type ParseExpenseRequest = z.infer<typeof ParseExpenseRequest>;

export const ParsePath = z.enum(['rules', 'llm', 'fallback']);
export type ParsePath = z.infer<typeof ParsePath>;

/** An expense form pre-filled from text: CreateExpense with every field optional. */
export const ExpenseDraft = CreateExpense.partial();
export type ExpenseDraft = z.infer<typeof ExpenseDraft>;

/** How one name from the text was matched against the group's members. */
export const NameResolution = z.discriminatedUnion('status', [
  z.object({ name: z.string(), status: z.literal('resolved'), userId: Uuid }),
  z.object({
    name: z.string(),
    status: z.literal('ambiguous'),
    candidates: z.array(UserRef).min(2),
  }),
  z.object({ name: z.string(), status: z.literal('unknown') }),
]);
export type NameResolution = z.infer<typeof NameResolution>;

export const PARSE_ISSUE_CODES = [
  'AMOUNT_MISSING',
  'AMOUNT_INVALID',
  'CURRENCY_MISMATCH',
  'DATE_INVALID',
  'PAYER_UNKNOWN',
  'SPLIT_SUM_MISMATCH',
  'PERCENT_SUM_INVALID',
  'SPLIT_VALUE_INVALID',
] as const;

/** Something the parser couldn't settle. The form highlights it for the user to fix. */
export const ParseIssue = z.object({ code: z.enum(PARSE_ISSUE_CODES), message: z.string() });
export type ParseIssue = z.infer<typeof ParseIssue>;

export const ParseResult = z.object({
  /** The ai_requests row, or null when the rule-based parser handled the text. */
  requestId: z.int().min(1).nullable(),
  path: ParsePath,
  groupId: Uuid.nullable(),
  draft: ExpenseDraft,
  resolutions: z.array(NameResolution),
  issues: z.array(ParseIssue),
});
export type ParseResult = z.infer<typeof ParseResult>;
