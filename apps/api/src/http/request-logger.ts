import type { MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';
import type { AppEnv } from './context';

/**
 * Invite tokens are bearer secrets that travel in URL paths: the invite page (/invite/<token>) and
 * its API (/api/v1/invites/<token>). Logs show `[token]` instead.
 */
export const redactPath = (path: string) => path.replace(/(\/invites?\/)[^/]+/g, '$1[token]');

/**
 * Gives the request a logger bound to its request ID, then writes one summary line when the
 * response is ready. The path is logged without its query string, which can hold search text,
 * and with invite tokens redacted.
 */
export function requestLogger(root: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    const log = root.child({ requestId: c.get('requestId') });
    c.set('log', log);

    await next();

    const { status } = c.res;
    const fields = {
      method: c.req.method,
      path: redactPath(c.req.path),
      status,
      ms: Math.round(performance.now() - started),
    };
    if (status >= 500) log.error(fields, 'request failed');
    else log.info(fields, 'request');
  };
}
