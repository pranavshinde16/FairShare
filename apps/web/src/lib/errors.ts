import { ApiError, type ApiErrorCode } from '@fairshare/api-client';

/** Friendly copy per error code: the one dictionary the UI uses (Blueprint 7.1). */
const COPY: Partial<Record<ApiErrorCode, string>> = {
  NETWORK_ERROR: 'Can’t reach FairShare. Check your connection and try again.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  VALIDATION_FAILED: 'Some details need fixing.',
  ORIGIN_NOT_ALLOWED: 'That request was blocked. Reload the page and try again.',
  PAYLOAD_TOO_LARGE: 'That’s too much to send at once.',
  RATE_LIMITED: 'Too many requests. Try again in a minute.',
  INVALID_RESPONSE: 'FairShare sent something unexpected. Reload the page.',
  INTERNAL: 'Something went wrong on our side. Try again.',
};

const FALLBACK = 'Something went wrong. Try again.';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return COPY[error.code] ?? error.message ?? FALLBACK;
  return FALLBACK;
}

/** The server's request ID, shown small under an error so a report can be matched to the logs. */
export function errorRequestId(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
