import { ApiError, type ApiErrorCode } from '@fairshare/api-client';

/**
 * Friendly copy for every error code: the one dictionary the UI uses (Blueprint 7.1). It is a full
 * Record, so a code added to the contracts without copy here fails the type check.
 */
export const ERROR_COPY: Record<ApiErrorCode, string> = {
  // The client's own.
  NETWORK_ERROR: 'Can’t reach FairShare. Check your connection and try again.',
  INVALID_RESPONSE: 'FairShare sent something unexpected. Reload the page.',

  // Requests.
  VALIDATION_FAILED: 'Some details need fixing.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  NOT_FOUND: 'This doesn’t exist, or you don’t have access to it.',
  ORIGIN_NOT_ALLOWED: 'That request was blocked. Reload the page and try again.',
  NOT_PERMITTED: 'Only the group’s owner can do that.',
  PAYLOAD_TOO_LARGE: 'That’s too much to send at once.',
  IF_MATCH_REQUIRED: 'FairShare needs to reload this before changing it. Reload the page.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  INTERNAL: 'Something went wrong on our side. Try again.',

  // Conflicts.
  VERSION_CONFLICT: 'Someone else changed this meanwhile. Reload to see their changes.',
  ID_CONFLICT: 'That was already saved. Reload the page.',
  BALANCE_NOT_ZERO: 'Everyone involved must be settled up first.',
  MERGE_CONFLICT:
    'You’re already in this group, so you can’t also claim one of its placeholders. Ask the group to remove it.',
  ALREADY_MEMBER: 'They’re already in this group.',
  CURRENCY_LOCKED: 'The currency can’t change once the group has expenses.',
  TRANSACTION_DELETED: 'This was deleted. Restore it before changing it.',
  INVITE_EXPIRED: 'This invite has expired. Ask for a new link.',

  // Rules about amounts and splits.
  INVALID_MONEY: 'Enter an amount like 2400 or 2,400.50.',
  INVALID_PERCENT: 'Enter a percentage from 0 to 100, like 33.33.',
  AMOUNT_OUT_OF_RANGE: 'An amount is out of range: too large, or not above zero.',
  NO_PARTICIPANTS: 'Choose at least one person who paid and one who shares the cost.',
  DUPLICATE_USER: 'Each person can appear only once.',
  INVALID_WEIGHT: 'Shares must be whole numbers of 0 or more.',
  SPLIT_SUM_MISMATCH: 'The split doesn’t add up to the total.',
  PAYER_SUM_MISMATCH: 'What people paid must add up to the total.',
  PERCENT_SUM_INVALID: 'The percentages must add up to 100%.',
  SETTLEMENT_SAME_USER: 'A payment needs two different people.',
  MEMBER_INACTIVE: 'Someone in this isn’t in the group any more.',
  NOT_A_MEMBER: 'Everyone in an expense must be in the group.',
  CURRENCY_MISMATCH: 'That isn’t the group’s currency.',
  CANNOT_MODIFY_DIRECT_GROUP: 'A friendship can’t be changed that way.',
  PLACEHOLDER_UNAVAILABLE: 'That person has already joined, or isn’t in the group any more.',

  // Typed entry, server side.
  AI_RATE_LIMITED: 'Try again in a minute.',
  AI_UNAVAILABLE: 'Couldn’t fully understand. Please check the details.',
};

const FALLBACK = 'Something went wrong. Try again.';

export function errorMessage(error: unknown): string {
  // Offline, any failure is most likely that (a fetch that never left reports a bare TypeError).
  if (globalThis.navigator?.onLine === false) return ERROR_COPY.NETWORK_ERROR;
  if (!(error instanceof ApiError)) return FALLBACK;
  // A code from a newer server than this page: its own message is the best there is.
  return (ERROR_COPY as Partial<Record<string, string>>)[error.code] ?? error.message ?? FALLBACK;
}

/** The server's request ID, shown small under an error so a report can be matched to the logs. */
export function errorRequestId(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
