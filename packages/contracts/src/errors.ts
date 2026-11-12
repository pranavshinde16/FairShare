import { z } from 'zod';

/**
 * Every error code the API can return, with its HTTP status. The API's error middleware maps codes
 * to statuses from this table and the UI maps codes to friendly copy, so codes are a stable
 * contract: add freely, rename with care.
 */
export const ERROR_HTTP_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404, // also for non-members, so IDs can't be probed

  ORIGIN_NOT_ALLOWED: 403, // a state-changing request that didn't come from the app's own pages
  NOT_PERMITTED: 403, // a member doing what only the owner (or an invite's creator) may do

  VERSION_CONFLICT: 409, // details: { currentVersion }
  ID_CONFLICT: 409,
  BALANCE_NOT_ZERO: 409,
  MERGE_CONFLICT: 409,
  ALREADY_MEMBER: 409,
  CURRENCY_LOCKED: 409, // changing a group's currency after it has transactions

  INVITE_EXPIRED: 410,

  PAYLOAD_TOO_LARGE: 413, // request bodies are capped at 64 KB

  IF_MATCH_REQUIRED: 428, // a mutation of an existing transaction sent no If-Match header

  // Valid shape, rejected by a rule. The first group comes from core's DomainError.
  INVALID_MONEY: 422,
  INVALID_PERCENT: 422,
  AMOUNT_OUT_OF_RANGE: 422,
  NO_PARTICIPANTS: 422,
  DUPLICATE_USER: 422,
  INVALID_WEIGHT: 422,
  SPLIT_SUM_MISMATCH: 422, // details: { expected, actual }
  PAYER_SUM_MISMATCH: 422, // details: { expected, actual }
  PERCENT_SUM_INVALID: 422, // details: { expected, actual }
  SETTLEMENT_SAME_USER: 422,
  MEMBER_INACTIVE: 422,
  NOT_A_MEMBER: 422,
  CURRENCY_MISMATCH: 422,
  CANNOT_MODIFY_DIRECT_GROUP: 422,
  PLACEHOLDER_UNAVAILABLE: 422, // not an unclaimed placeholder in this group

  RATE_LIMITED: 429,
  AI_RATE_LIMITED: 429,

  INTERNAL: 500,
  AI_UNAVAILABLE: 503,
} as const satisfies Record<
  string,
  400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 428 | 429 | 500 | 503
>;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const ERROR_CODES = Object.keys(ERROR_HTTP_STATUS) as [ErrorCode, ...ErrorCode[]];

export const ErrorCode = z.enum(ERROR_CODES);

/**
 * The body of every non-2xx response. `code` is a plain string here so a client reading a response
 * from a newer server still parses it; the API client narrows it to ErrorCode.
 */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// ---- details for specific codes -----------------------------------------------------------------

/** One problem in a request that failed validation. `path` points at the field, e.g. ["payers", 0, "amount"]. */
export const ValidationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** details for VALIDATION_FAILED. */
export const ValidationFailedDetails = z.object({ issues: z.array(ValidationIssue) });
export type ValidationFailedDetails = z.infer<typeof ValidationFailedDetails>;

/** Converts a zod error into VALIDATION_FAILED details, for the API's error middleware. */
export function toValidationDetails(error: z.ZodError): ValidationFailedDetails {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
      message: issue.message,
      code: issue.code,
    })),
  };
}

/** details for VERSION_CONFLICT: the version the client should reload. */
export const VersionConflictDetails = z.object({ currentVersion: z.int().min(1) });

/** details for SPLIT_SUM_MISMATCH, PAYER_SUM_MISMATCH and PERCENT_SUM_INVALID. */
export const SumMismatchDetails = z.object({ expected: z.int(), actual: z.int() });
