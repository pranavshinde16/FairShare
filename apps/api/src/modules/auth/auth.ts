// Better Auth: email sign-in codes and Google, sessions in Postgres, mounted at /api/auth/*.
// The rest of the API sees it only through AuthGateway.

import type { SignInOptions } from '@fairshare/contracts';
import { auth_account, auth_session, auth_user, auth_verification, type Db } from '@fairshare/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { Logger } from 'pino';
import type { ErrorReporter } from '../../http/error-handler';
import { currentRequest } from '../../http/request-context';
import type { RateLimiter } from '../../lib/rate-limit';
import type { AuthUserInfo } from '../users/service';
import { CODE_TTL_MINUTES } from './sign-in-email';

/** What the rest of the API needs from the auth library. Tests substitute a fake. */
export type AuthGateway = {
  /** Answers every /api/auth/* request. */
  handler: (request: Request) => Promise<Response>;
  /** The session for a request's cookies, or null. `setCookies` carries a refreshed cookie. */
  getSession: (headers: Headers) => Promise<AuthSession | null>;
  signInOptions: SignInOptions;
};

export type AuthSession = { authUser: AuthUserInfo; setCookies: string[] };

export type AuthConfig = {
  /** The public origin; Better Auth builds redirects from it and trusts only it. */
  appUrl: string;
  secret: string;
  google?: { clientId: string; clientSecret: string };
  /** Proxy headers holding the client IP, for per-IP rate limits. */
  clientIpHeaders: string[];
  /**
   * Better Auth's per-IP limits on its endpoints (stricter on sign-in). Set explicitly, rather than
   * left to Better Auth's "only when NODE_ENV=production" default.
   */
  rateLimit: boolean;
};

export type AuthDeps = {
  db: Db;
  logger: Logger;
  reportError: ErrorReporter;
  /** Delivers a sign-in code. Never throws: failures are logged and reported. */
  sendSignInCode: (email: string, code: string) => Promise<void>;
  /** Creates the domain user. Never throws; the auth middleware retries on the next request. */
  onUserCreated: (user: AuthUserInfo, acceptLanguage: string | null) => Promise<void>;
  /** Sign-in codes per email address, on top of Better Auth's own per-IP limits. */
  codeLimiter: RateLimiter;
};

const DAY_SECONDS = 24 * 60 * 60;

export const SESSION_DAYS = 30;

/** The paths Better Auth answers, relative to /api/auth. */
const SEND_CODE_PATH = '/email-otp/send-verification-otp';

export function createAuth(config: AuthConfig, deps: AuthDeps) {
  const auth = betterAuth({
    appName: 'FairShare',
    baseURL: config.appUrl,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.appUrl],
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      schema: { auth_user, auth_session, auth_account, auth_verification },
    }),
    // The same model names as packages/db/auth-schema.config.ts, which generated the tables.
    user: { modelName: 'auth_user' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    session: {
      modelName: 'auth_session',
      // 30 days, rolling: a session used at least once a day is extended by another 30.
      expiresIn: SESSION_DAYS * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    emailAndPassword: { enabled: false },
    // In memory: one instance (Railway runs one replica), like the API's own limits.
    rateLimit: { enabled: config.rateLimit, storage: 'memory' },
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
            // Always show the account chooser, so a shared computer doesn't sign in silently.
            prompt: 'select_account',
          },
        }
      : {},
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_TTL_MINUTES * 60,
        allowedAttempts: 3,
        // Only a hash is stored, so a database leak reveals no usable code.
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Only sign-in is used: email verification and password reset are off.
          if (type === 'sign-in') await deps.sendSignInCode(email, otp);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            const headers = ctx?.headers ?? ctx?.request?.headers;
            await deps.onUserCreated(user, headers?.get('accept-language') ?? null);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware((ctx) => {
        if (ctx.path !== SEND_CODE_PATH) return Promise.resolve();
        const body = ctx.body as { email?: unknown } | undefined;
        const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!email) return Promise.resolve(); // Better Auth rejects it
        const result = deps.codeLimiter.consume(email);
        if (!result.allowed) {
          const error = new APIError(
            'TOO_MANY_REQUESTS',
            {
              code: 'TOO_MANY_CODES',
              message: 'Too many codes for this email. Wait a few minutes and try again.',
            },
            { 'Retry-After': String(result.retryAfterSeconds) },
          );
          return Promise.reject(error);
        }
        return Promise.resolve();
      }),
    },
    advanced: {
      // Cookies are named fairshare.session_token, with the __Secure- prefix over https.
      cookiePrefix: 'fairshare',
      // Origin and callback-URL checks on, in tests too (Better Auth skips them when
      // NODE_ENV=test unless told otherwise), so tests exercise what production runs.
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: config.clientIpHeaders },
    },
    // Failed Google sign-ins come back to the sign-in screen with ?error=<code>.
    onAPIError: {
      errorURL: `${config.appUrl}/sign-in`,
      onError: (error) => {
        if (error instanceof APIError) return; // an expected 4xx, answered by Better Auth
        deps.reportError(error, { requestId: currentRequest()?.requestId });
      },
    },
    logger: {
      level: 'debug',
      log: (level, message, ...args) => log(deps.logger, level, message, args),
    },
    telemetry: { enabled: false },
  });

  const gateway: AuthGateway = {
    handler: (request) => auth.handler(request),
    async getSession(headers) {
      const { headers: responseHeaders, response } = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      if (!response) return null;
      return { authUser: response.user, setCookies: responseHeaders.getSetCookie() };
    },
    signInOptions: { google: config.google !== undefined },
  };
  return gateway;
}

/** Better Auth's log lines go to pino, on the current request's logger when there is one. */
function log(
  root: Logger,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  args: unknown[],
) {
  const logger = currentRequest()?.log ?? root;
  const err = args.find((arg) => arg instanceof Error);
  const details = args.filter((arg) => arg !== err);
  logger[level]({ ...(err && { err }), ...(details.length && { details }) }, `auth: ${message}`);
}
