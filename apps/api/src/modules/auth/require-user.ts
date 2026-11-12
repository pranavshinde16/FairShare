import type { MiddlewareHandler } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { AppError } from '../../http/errors';
import type { AuthGateway } from './auth';
import type { DomainUserResolver } from './domain-users';

/**
 * Lets a request through only with a valid session, and sets c.var.user to the signed-in domain
 * user. When Better Auth extends the session (it rolls forward once a day), its refreshed cookie
 * is passed on.
 */
export function requireUser(
  auth: AuthGateway,
  domainUsers: DomainUserResolver,
): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const session = await auth.getSession(c.req.raw.headers);
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
    for (const cookie of session.setCookies) c.header('Set-Cookie', cookie, { append: true });

    const id = await domainUsers.idFor(session.authUser, c.req.header('Accept-Language'));
    c.set('user', { id, authUserId: session.authUser.id });
    c.set('log', c.get('log').child({ userId: id }));
    await next();
  };
}
