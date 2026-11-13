import { DeleteAccount, UpdateProfile } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import type { UsersService } from './service';

/** GET, PATCH and DELETE /me: the signed-in user's own profile and account. */
export function usersRoutes(users: UsersService) {
  return (
    new Hono<AuthedEnv>()
      .get('/me', async (c) => c.json(await users.getProfile(c.var.user.id)))
      .patch('/me', validate('json', UpdateProfile), async (c) =>
        c.json(await users.updateProfile(c.var.user.id, c.req.valid('json'))),
      )
      // The body {confirm: "DELETE"} (Blueprint 6) makes an accidental deletion impossible.
      .delete('/me', validate('json', DeleteAccount), async (c) => {
        await users.deleteAccount(c.var.user.id);
        // The session row is gone with the auth user; this clears the browser's cookie too.
        c.header('Clear-Site-Data', '"cookies", "storage"');
        return c.body(null, 204);
      })
  );
}
