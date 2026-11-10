import type { HealthResponse } from '@fairshare/contracts';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Logger } from 'pino';
import type { AppEnv } from './http/context';
import { errorHandler, errorResponse, type ErrorReporter } from './http/error-handler';
import { requestLogger } from './http/request-logger';
import { securityHeaders } from './http/security';
import { REVALIDATE, wantsAppPage, webFiles, type WebAssets } from './http/web';

export type AppDeps = {
  pingDatabase: () => Promise<HealthResponse['db']>;
  logger: Logger;
  /** Where unexpected errors are reported (Sentry in production). */
  reportError: ErrorReporter;
  /** The built web app to serve, or null when Vite serves it (development). */
  web: WebAssets | null;
};

/** Builds the HTTP app from its dependencies, so tests can pass in fakes. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // Order matters: the request ID comes first so the logger and every error can carry it.
  app.use(requestId());
  app.use(requestLogger(deps.logger));
  app.use(securityHeaders());

  app.get('/api/health', async (c) => {
    const db = await deps.pingDatabase();
    const body: HealthResponse = { ok: db === 'up', db };
    return c.json(body, db === 'up' ? 200 : 503);
  });

  // Feature routes mount under /api/v1 from Phase 5 on.

  if (deps.web) app.use(webFiles(deps.web));

  app.notFound((c) => {
    if (deps.web && wantsAppPage(c)) {
      return c.html(deps.web.indexHtml, 200, { 'Cache-Control': REVALIDATE });
    }
    return errorResponse(c, { status: 404, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  app.onError(errorHandler(deps.reportError));

  return app;
}
