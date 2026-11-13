// Builds the real app from configuration: the one wiring used by the server and by integration
// tests, so tests exercise exactly what production runs.

import type { Db } from '@fairshare/db';
import type { Logger } from 'pino';
import { createApp, type AppDeps } from './app';
import type { Env } from './config/env';
import type { ErrorReporter } from './http/error-handler';
import { currentRequest } from './http/request-context';
import type { EmailSender } from './lib/email';
import { createRateLimiter, type RateLimiter } from './lib/rate-limit';
import { createAuth } from './modules/auth/auth';
import { createDomainUserResolver } from './modules/auth/domain-users';
import { createSignInCodeSender } from './modules/auth/sign-in-email';
import { createActivityService } from './modules/activity/service';
import { createBalancesService } from './modules/balances/service';
import { createClaimsService } from './modules/claims/service';
import { createCurrenciesService } from './modules/currencies/service';
import { createFriendsService } from './modules/friends/service';
import { createGroupsService } from './modules/groups/service';
import { createInvitesService } from './modules/invites/service';
import { createTransactionsService } from './modules/transactions/service';
import { createUsersService } from './modules/users/service';

export type ComposeOptions = {
  env: Pick<
    Env,
    'APP_URL' | 'AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'CLIENT_IP_HEADERS'
  >;
  db: Db;
  pingDatabase: AppDeps['pingDatabase'];
  logger: Logger;
  reportError: ErrorReporter;
  emailSender: EmailSender;
  web: AppDeps['web'];
  /** Overrides the sign-in code limit (3 codes per email per 10 minutes), for tests. */
  codeLimiter?: RateLimiter;
  /** Overrides the invite preview limit (30 a minute per IP), for tests. */
  invitePreviewLimiter?: RateLimiter;
  /** Overrides the other public routes' limit (60 a minute per IP), for tests. */
  publicLimiter?: RateLimiter;
  /** Overrides the signed-in API's limit (120 a minute per user), for tests. */
  userLimiter?: RateLimiter;
  /** Better Auth's own per-IP limits on sign-in. On unless a test turns them off. */
  authRateLimit?: boolean;
  /** "Now", for tests that need a fixed today. */
  clock?: () => Date;
};

/** Sign-in codes per email address: enough for two resends, too few to flood an inbox. */
export const CODES_PER_EMAIL = { max: 3, windowMs: 10 * 60 * 1000 };

/** Public invite previews per client IP (Blueprint 9.1). */
export const INVITE_PREVIEWS_PER_IP = { max: 30, windowMs: 60 * 1000 };

/** The other public routes per client IP: health checks and the sign-in screen's options. */
export const PUBLIC_REQUESTS_PER_IP = { max: 60, windowMs: 60 * 1000 };

/** The signed-in API per user (Blueprint 9.1). */
export const API_REQUESTS_PER_USER = { max: 120, windowMs: 60 * 1000 };

export function composeApp(options: ComposeOptions) {
  const { env, db, logger, reportError } = options;
  const users = createUsersService(db);
  const domainUsers = createDomainUserResolver(users);
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  const auth = createAuth(
    {
      appUrl: env.APP_URL,
      secret: env.AUTH_SECRET,
      google,
      clientIpHeaders: env.CLIENT_IP_HEADERS,
      rateLimit: options.authRateLimit ?? true,
    },
    {
      db,
      logger,
      reportError,
      sendSignInCode: createSignInCodeSender({ sender: options.emailSender, logger, reportError }),
      onUserCreated: async (user, acceptLanguage) => {
        try {
          await domainUsers.idFor(user, acceptLanguage);
        } catch (err) {
          const request = currentRequest();
          (request?.log ?? logger).error({ err }, 'creating the domain user failed; will retry');
          reportError(err, { requestId: request?.requestId });
        }
      },
      codeLimiter: options.codeLimiter ?? createRateLimiter(CODES_PER_EMAIL),
    },
  );

  return createApp({
    pingDatabase: options.pingDatabase,
    logger,
    reportError,
    web: options.web,
    appOrigin: env.APP_URL,
    auth,
    domainUsers,
    users,
    currencies: createCurrenciesService(db),
    groups: createGroupsService(db),
    invites: createInvitesService(db, env.APP_URL),
    friends: createFriendsService(db),
    claims: createClaimsService(db),
    transactions: createTransactionsService(db, options.clock),
    balances: createBalancesService(db),
    activity: createActivityService(db),
    invitePreviewLimiter: options.invitePreviewLimiter ?? createRateLimiter(INVITE_PREVIEWS_PER_IP),
    publicLimiter: options.publicLimiter ?? createRateLimiter(PUBLIC_REQUESTS_PER_IP),
    userLimiter: options.userLimiter ?? createRateLimiter(API_REQUESTS_PER_USER),
    clientIpHeaders: env.CLIENT_IP_HEADERS,
  });
}
