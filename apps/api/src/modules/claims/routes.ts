import { Uuid } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { AppError } from '../../http/errors';
import type { ClaimsService } from './service';

const placeholderId = (value: string) => {
  const id = Uuid.safeParse(value);
  if (!id.success) throw new AppError('NOT_FOUND', 'There’s no placeholder for you to claim here.');
  return id.data;
};

/** Placeholders made with my email address, which I can claim or dismiss. */
export function claimsRoutes(claims: ClaimsService) {
  return new Hono<AuthedEnv>()
    .get('/claims', async (c) => c.json(await claims.list(c.var.user.id)))
    .post('/claims/:placeholderId', async (c) =>
      c.json(await claims.claim(c.var.user.id, placeholderId(c.req.param('placeholderId')))),
    )
    .delete('/claims/:placeholderId', async (c) => {
      await claims.dismiss(c.var.user.id, placeholderId(c.req.param('placeholderId')));
      return c.body(null, 204);
    });
}
