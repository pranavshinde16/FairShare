import type { HealthResponse } from '@fairshare/contracts';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { Logger } from 'pino';
import type { AppEnv, AuthedEnv } from './http/context';
import { errorHandler, errorResponse, type ErrorReporter } from './http/error-handler';
import { limitBodySize, protectMutations } from './http/guards';
import { requestLogger } from './http/request-logger';
import { securityHeaders } from './http/security';
import { REVALIDATE, wantsAppPage, webFiles, type WebAssets } from './http/web';
import type { AuthGateway } from './modules/auth/auth';
import type { DomainUserResolver } from './modules/auth/domain-users';
import { requireUser } from './modules/auth/require-user';
import { signInOptionsRoutes } from './modules/auth/routes';
import { activityRoutes } from './modules/activity/routes';
import type { ActivityService } from './modules/activity/service';
import { balancesRoutes } from './modules/balances/routes';
import type { BalancesService } from './modules/balances/service';
import { claimsRoutes } from './modules/claims/routes';
import type { ClaimsService } from './modules/claims/service';
import { currenciesRoutes } from './modules/currencies/routes';
import type { CurrenciesService } from './modules/currencies/service';
import { friendsRoutes } from './modules/friends/routes';
import type { FriendsService } from './modules/friends/service';
import { groupsRoutes } from './modules/groups/routes';
import type { GroupsService } from './modules/groups/service';
import { inviteAcceptRoutes, invitePreviewRoutes } from './modules/invites/routes';
import type { InvitesService } from './modules/invites/service';
import { transactionRoutes } from './modules/transactions/routes';
import type { TransactionsService } from './modules/transactions/service';
import { usersRoutes } from './modules/users/routes';
import type { UsersService } from './modules/users/service';
import type { RateLimiter } from './lib/rate-limit';

export type AppDeps = {
  /** Gets the request's logger, so the reason for a "down" is logged with the request ID. */
  pingDatabase: (log: Logger) => Promise<HealthResponse['db']>;
  logger: Logger;
  /** Where unexpected errors are reported (Sentry in production). */
  reportError: ErrorReporter;
  /** The built web app to serve, or null when Vite serves it (development). */
  web: WebAssets | null;
  /** The app's public origin. State-changing API requests must come from it. */
  appOrigin: string;
  auth: AuthGateway;
  domainUsers: DomainUserResolver;
  users: UsersService;
  currencies: CurrenciesService;
  groups: GroupsService;
  invites: InvitesService;
  friends: FriendsService;
  claims: ClaimsService;
  transactions: TransactionsService;
  balances: BalancesService;
  activity: ActivityService;
  /** The public invite preview: 30 a minute per client IP. */
  invitePreviewLimiter: RateLimiter;
  /** Proxy headers holding the client IP (CLIENT_IP_HEADERS). */
  clientIpHeaders: string[];
};

/** Builds the HTTP app from its dependencies, so tests can pass in fakes. */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // Order matters: the request ID comes first so the logger and every error can carry it.
  app.use(requestId());
  app.use(requestLogger(deps.logger));
  app.use(securityHeaders());
  app.use('/api/*', limitBodySize());

  app.get('/api/health', async (c) => {
    const db = await deps.pingDatabase(c.get('log'));
    const body: HealthResponse = { ok: db === 'up', db };
    return c.json(body, db === 'up' ? 200 : 503);
  });

  // Better Auth answers sign-in, sign-out and sessions itself, with its own CSRF checks.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  const v1 = new Hono<AppEnv>();
  v1.use(protectMutations(deps.appOrigin));
  // Public routes first: they answer before requireUser, which applies to everything after it.
  v1.route('/', signInOptionsRoutes(deps.auth));
  v1.route('/', invitePreviewRoutes(deps.invites, deps.invitePreviewLimiter, deps.clientIpHeaders));
  const signedIn = new Hono<AuthedEnv>();
  signedIn.use(requireUser(deps.auth, deps.domainUsers));
  signedIn.route('/', usersRoutes(deps.users));
  signedIn.route('/', currenciesRoutes(deps.currencies));
  signedIn.route('/', groupsRoutes(deps));
  signedIn.route('/', transactionRoutes(deps.transactions));
  signedIn.route('/', inviteAcceptRoutes(deps.invites));
  signedIn.route('/', friendsRoutes(deps.friends));
  signedIn.route('/', balancesRoutes(deps.balances));
  signedIn.route('/', activityRoutes(deps.activity));
  signedIn.route('/', claimsRoutes(deps.claims));
  v1.route('/', signedIn);
  app.route('/api/v1', v1);

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
