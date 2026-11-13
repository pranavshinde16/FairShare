import { AcceptInvite, InviteToken } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AppEnv, AuthedEnv } from '../../http/context';
import { AppError } from '../../http/errors';
import { clientIp } from '../../http/client-ip';
import { rateLimit } from '../../http/rate-limit';
import { validate } from '../../http/validate';
import type { RateLimiter } from '../../lib/rate-limit';
import type { InvitesService } from './service';

const unknownInvite = () => new AppError('NOT_FOUND', 'This invite link doesn’t work any more.');

/** GET /invites/:token: public, so someone can see what they're joining before signing in. */
export function invitePreviewRoutes(
  invites: InvitesService,
  limiter: RateLimiter,
  clientIpHeaders: string[],
) {
  // 30 a minute per IP (Blueprint 9.1), so tokens can't be guessed at speed.
  return new Hono<AppEnv>().get(
    '/invites/:token',
    rateLimit(limiter, (c) => clientIp(c, clientIpHeaders)),
    async (c) => {
      const token = InviteToken.safeParse(c.req.param('token'));
      if (!token.success) throw unknownInvite();
      return c.json(await invites.preview(token.data));
    },
  );
}

/** POST /invites/:token/accept: signed in. */
export function inviteAcceptRoutes(invites: InvitesService) {
  return new Hono<AuthedEnv>().post(
    '/invites/:token/accept',
    validate('json', AcceptInvite),
    async (c) => {
      const token = InviteToken.safeParse(c.req.param('token'));
      if (!token.success) throw unknownInvite();
      return c.json(await invites.accept(c.var.user.id, token.data, c.req.valid('json')));
    },
  );
}
