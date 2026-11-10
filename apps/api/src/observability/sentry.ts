import * as Sentry from '@sentry/node';
import type { Env } from '../config/env';
import type { ErrorReporter } from '../http/error-handler';

/**
 * Sentry 11 collects request data by default: cookies, headers, bodies, query strings, local
 * variables in stack frames and database query parameters. Any of those can hold emails, OTPs or
 * session cookies, and a stack trace is all we need, so every category is off (Blueprint 9.1).
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions['dataCollection'];

/**
 * Starts error tracking when SENTRY_DSN is set and returns the reporter the error handler calls.
 * Only unexpected errors (500s) are reported, and there is no performance tracing.
 */
export function initSentry(
  env: Pick<Env, 'NODE_ENV' | 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT' | 'SENTRY_RELEASE'>,
  overrides: Pick<Sentry.NodeOptions, 'transport'> = {},
): ErrorReporter {
  if (!env.SENTRY_DSN) return () => {};

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    dataCollection: DATA_COLLECTION,
    ...overrides,
  });
  return (error, { requestId }) => {
    Sentry.withScope((scope) => {
      scope.setTag('requestId', requestId);
      Sentry.captureException(error);
    });
  };
}

/** Sends anything still queued. Called on shutdown; resolves even if Sentry was never started. */
export const flushSentry = (timeoutMs: number) => Sentry.close(timeoutMs);
