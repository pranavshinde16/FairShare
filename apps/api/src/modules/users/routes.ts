import { UpdateProfile } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import type { UsersService } from './service';

/** GET and PATCH /me: the signed-in user's own profile. */
export function usersRoutes(users: UsersService) {
  return new Hono<AuthedEnv>()
    .get('/me', async (c) => c.json(await users.getProfile(c.var.user.id)))
    .patch('/me', validate('json', UpdateProfile), async (c) =>
      c.json(await users.updateProfile(c.var.user.id, c.req.valid('json'))),
    );
}
