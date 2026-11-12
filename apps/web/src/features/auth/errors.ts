/** The error Better Auth's client returns: its code (when it has one) and the HTTP status. */
export type AuthClientError = { code?: string; message?: string; status?: number };

/** Codes for the most specific copy; Better Auth's own messages are not shown to users. */
const COPY: Record<string, string> = {
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_OTP: 'Code is incorrect.',
  OTP_EXPIRED: 'Code expired.',
  TOO_MANY_ATTEMPTS: 'Too many tries. Get a new code.',
  TOO_MANY_CODES: 'Too many codes for this email. Wait a few minutes and try again.',
};

export function signInErrorMessage(error: AuthClientError): string {
  if (error.code && COPY[error.code]) return COPY[error.code]!;
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (!error.status) return 'Can’t reach FairShare. Check your connection and try again.';
  return 'Something went wrong. Try again.';
}

/** Errors a Google sign-in can come back with (?error=…), in plain words. */
export function googleErrorMessage(code: string): string {
  if (code === 'access_denied') return 'Google sign-in was cancelled.';
  return 'Google sign-in didn’t finish. Try again, or use an email code.';
}
