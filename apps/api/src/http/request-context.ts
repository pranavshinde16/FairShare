import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';

export type RequestContext = { requestId: string; log: Logger };

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with the request's ID and logger available to code that has no Hono context, such as
 * Better Auth's callbacks.
 */
export const runInRequest = <T>(context: RequestContext, fn: () => T): T =>
  storage.run(context, fn);

/** The current request's ID and logger, or undefined outside a request. */
export const currentRequest = (): RequestContext | undefined => storage.getStore();
