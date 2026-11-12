import { createDb } from '@fairshare/db';
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { composeApp } from './compose';
import { loadEnv, type Env } from './config/env';
import { createPool, pingDatabase } from './db/pool';
import { loadWebAssets } from './http/web';
import { createEmailSender } from './lib/email';
import { createLogger } from './observability/logger';
import { flushSentry, initSentry } from './observability/sentry';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });
const reportError = initSentry(env);
const pool = createPool(env.DATABASE_URL, logger);
const web = env.WEB_DIST_DIR ? loadWebAssets(resolve(env.WEB_DIST_DIR)) : null;
const app = composeApp({
  env,
  db: createDb(pool),
  pingDatabase: (log) => pingDatabase(pool, log),
  logger,
  reportError,
  emailSender: createEmailSender(env),
  web,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  logger.info(
    { port, env: env.NODE_ENV, appUrl: env.APP_URL, web: web?.root ?? null },
    'FairShare API listening',
  );
});

// The platform sends SIGTERM before replacing the container: finish in-flight requests, close the
// pool, flush Sentry. If that hangs, exit anyway rather than be killed mid-way.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    void pool
      .end()
      .then(() => flushSentry(2_000))
      .then(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
