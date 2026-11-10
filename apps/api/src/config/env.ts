import { z } from 'zod';

const PostgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string({ error: 'is required' }).pipe(PostgresUrl),
  // The pre-deploy migration's connection: the owner role, unpooled. Defaults to DATABASE_URL,
  // which is right locally. On hosted Postgres the app's own role can't create tables.
  MIGRATION_DATABASE_URL: PostgresUrl.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Error tracking. Without a DSN nothing is sent anywhere.
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(), // defaults to NODE_ENV; set "staging" on staging
  SENTRY_RELEASE: z.string().optional(), // usually the git commit

  // The built web app (apps/web/dist). When set, the API serves it with an SPA fallback, as in the
  // Docker image. Unset in development, where Vite serves the app.
  WEB_DIST_DIR: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses and validates the environment once at boot. The server refuses to start
 * with a missing or malformed variable instead of failing later at request time.
 * An empty variable counts as unset, since hosting dashboards often leave blanks.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = EnvSchema.safeParse(set);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
