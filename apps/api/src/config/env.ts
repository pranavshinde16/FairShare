import { z } from 'zod';

const PostgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string');

/** An origin such as https://fairshare.example: scheme, host and port only, no path. */
const Origin = z
  .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
  .refine((value) => new URL(value).origin === value.replace(/\/$/, ''), {
    message: 'must be an origin only, like https://fairshare.example (no path)',
  })
  .transform((value) => new URL(value).origin);

/** Where the browser opens the app with `pnpm dev`: Vite, which proxies /api to the server. */
export const DEV_APP_URL = 'http://localhost:5173';

const DatabaseSchema = z.object({
  DATABASE_URL: z.string({ error: 'is required' }).pipe(PostgresUrl),
  // The pre-deploy migration's connection: the owner role, unpooled. Defaults to DATABASE_URL,
  // which is right locally. On hosted Postgres the app's own role can't create tables.
  MIGRATION_DATABASE_URL: PostgresUrl.optional(),
});

const EnvSchema = DatabaseSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // The address people open the app at, e.g. https://fairshareapi-staging.up.railway.app.
  // Sign-in redirects are built from it, and state-changing requests must come from it.
  // Required except in development, where it defaults to the Vite dev server.
  APP_URL: Origin.optional(),
  // Signs session cookies and encrypts auth data. Generate with `openssl rand -base64 32`.
  // Changing it signs everyone out.
  AUTH_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 characters'),
  // Google sign-in, from a Google Cloud OAuth client. Set both or neither; without them the
  // sign-in screen offers email codes only.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Email (sign-in codes). Resend when RESEND_API_KEY is set; otherwise Mailpit, the local inbox
  // from docker-compose.yml. Tests use an in-memory outbox and need neither.
  RESEND_API_KEY: z.string().optional(),
  MAILPIT_URL: z.url().optional(),
  // The sender, e.g. "FairShare <codes@fairshare.example>". Resend needs an address on a domain
  // verified in its dashboard.
  EMAIL_FROM: z.string().optional(),

  // Request headers that carry the client's IP address, set by the hosting proxy (Railway:
  // x-real-ip; behind Cloudflare: cf-connecting-ip). Sign-in rate limits are counted per IP.
  CLIENT_IP_HEADERS: z
    .string()
    .default('x-real-ip')
    .transform((value) =>
      value
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean),
    ),

  // Error tracking. Without a DSN nothing is sent anywhere.
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(), // defaults to NODE_ENV; set "staging" on staging
  SENTRY_RELEASE: z.string().optional(), // usually the git commit

  // The built web app (apps/web/dist). When set, the API serves it with an SPA fallback, as in the
  // Docker image. Unset in development, where Vite serves the app.
  WEB_DIST_DIR: z.string().optional(),
})
  .superRefine((env, ctx) => {
    if (!env.APP_URL && env.NODE_ENV !== 'development') {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'is required' });
    }
    if (!env.GOOGLE_CLIENT_ID !== !env.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: [env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'is required when the other Google variable is set',
      });
    }
    if (env.NODE_ENV !== 'test' && !env.RESEND_API_KEY && !env.MAILPIT_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'or MAILPIT_URL is required, so sign-in codes can be sent',
      });
    }
    if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'is required with RESEND_API_KEY (an address on your verified domain)',
      });
    }
  })
  .transform(({ APP_URL, ...env }) => ({ ...env, APP_URL: APP_URL ?? DEV_APP_URL }));

export type Env = z.infer<typeof EnvSchema>;
export type DatabaseEnv = z.infer<typeof DatabaseSchema>;

/**
 * Parses and validates the environment once at boot. The server refuses to start
 * with a missing or malformed variable instead of failing later at request time.
 * An empty variable counts as unset, since hosting dashboards often leave blanks.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parse(EnvSchema, source);
}

/** Only the database settings: all the pre-deploy migration step needs. */
export function loadDatabaseEnv(
  source: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  return parse(DatabaseSchema, source);
}

function parse<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(set);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
