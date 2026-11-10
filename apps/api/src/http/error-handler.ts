// The one place errors become responses. Every non-2xx body is the contracts ErrorEnvelope, and
// every one carries the request ID, so a user's report can be matched to the logs.

import { ERROR_HTTP_STATUS, toValidationDetails, type ErrorEnvelope } from '@fairshare/contracts';
import { DomainError } from '@fairshare/core';
import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { AppEnv } from './context';
import { AppError } from './errors';

/** Shown for every unexpected error. The real cause goes to the logs and Sentry, never the client. */
export const INTERNAL_MESSAGE = 'Something went wrong on our side. Please try again.';

/** Sends an unexpected error to error tracking. */
export type ErrorReporter = (error: unknown, context: { requestId: string }) => void;

type Described = { status: ContentfulStatusCode; error: Omit<ErrorEnvelope['error'], 'requestId'> };

/** Maps an error the client caused to its response, or returns null for an unexpected error. */
export function describeError(error: unknown): Described | null {
  if (error instanceof AppError) {
    return {
      status: error.status,
      error: { code: error.code, message: error.message, details: error.details },
    };
  }
  // core's rule violations (bad split, sums that don't match) are the user's to fix.
  if (error instanceof DomainError) {
    return {
      status: ERROR_HTTP_STATUS[error.code],
      error: { code: error.code, message: error.message, details: error.details },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid.',
        details: toValidationDetails(error),
      },
    };
  }
  // Hono raises 400 for a body that isn't valid JSON. No other HTTPException is expected; one that
  // appears is treated as a bug until it gets its own mapping here.
  if (error instanceof HTTPException && error.status === 400) {
    return { status: 400, error: { code: 'VALIDATION_FAILED', message: error.message } };
  }
  return null;
}

/** Renders the error envelope with the given status. */
export function errorResponse(c: Context<AppEnv>, { status, error }: Described) {
  const body: ErrorEnvelope = { error: { ...error, requestId: c.get('requestId') } };
  return c.json(body, status);
}

export function errorHandler(report: ErrorReporter): ErrorHandler<AppEnv> {
  return (error, c) => {
    const described = describeError(error);
    if (described) return errorResponse(c, described);

    c.get('log').error({ err: error }, 'unhandled error');
    report(error, { requestId: c.get('requestId') });
    return errorResponse(c, {
      status: 500,
      error: { code: 'INTERNAL', message: INTERNAL_MESSAGE },
    });
  };
}
