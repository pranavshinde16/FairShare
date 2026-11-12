// Request checks that apply before any route: a body-size cap, and for state-changing API calls,
// proof that the request came from the app itself.

import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from './context';
import { errorResponse } from './error-handler';
import { AppError } from './errors';

export const MAX_BODY_BYTES = 64 * 1024;

/** Rejects request bodies over 64 KB with 413 PAYLOAD_TOO_LARGE, before they are read in full. */
export const limitBodySize = (): MiddlewareHandler<AppEnv> =>
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    // bodyLimit types its context loosely; it's this app's.
    onError: (c: Context<AppEnv>) =>
      errorResponse(c, {
        status: 413,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is larger than 64 KB.' },
      }),
  });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_TYPE = /^application\/([\w.-]+\+)?json\s*(;|$)/i;

/**
 * CSRF protection for /api/v1 on top of SameSite=Lax cookies: a request that changes anything
 * must carry the app's own Origin, which browsers always send with fetch and never let a page
 * forge, and any body must be JSON, which a cross-site HTML form can't send.
 */
export function protectMutations(appOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header('Origin') !== appOrigin) {
      throw new AppError('ORIGIN_NOT_ALLOWED', 'This request must come from the FairShare app.');
    }
    const type = c.req.header('Content-Type');
    if (type !== undefined && !JSON_TYPE.test(type)) {
      throw new AppError('VALIDATION_FAILED', 'Send the request body as JSON.', {
        issues: [{ path: [], message: 'Expected Content-Type: application/json', code: 'custom' }],
      });
    }
    await next();
  };
}
