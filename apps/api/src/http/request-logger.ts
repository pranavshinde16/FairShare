import type { MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';
import type { AppEnv } from './context';
import { runInRequest } from './request-context';

/**
 * Invite tokens are bearer secrets that travel in URL paths: the invite page (/invite/<token>) and
 * its API (/api/v1/invites/<token>). Logs show `[token]` instead.
 */
export const redactPath = (path: string) => path.replace(/(\/invites?\/)[^/]+/g, '$1[token]');

/**
 * Gives the request a logger bound to its request ID (also reachable through currentRequest()),
 * then writes one summary line when the response is ready. The path is logged without its query
 * string, which can hold search text, and with invite tokens redacted.
 */
export function requestLogger(root: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    const requestId = c.get('requestId');
    const log = root.child({ requestId });
    c.set('log', log);

    await runInRequest({ requestId, log }, next);

    const { status } = c.res;
    const fields = {
      method: c.req.method,
      path: redactPath(c.req.path),
      status,
      ms: Math.round(performance.now() - started),
    };
    // The route may have bound more to the logger by now, such as the signed-in user's ID.
    const done = c.get('log');
    if (status >= 500) done.error(fields, 'request failed');
    else done.info(fields, 'request');
  };
}
