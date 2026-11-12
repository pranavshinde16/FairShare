import { AddFriend } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import type { FriendsService } from './service';

export function friendsRoutes(friends: FriendsService) {
  return new Hono<AuthedEnv>()
    .post('/friends', validate('json', AddFriend), async (c) => {
      const { response, created } = await friends.addFriend(c.var.user.id, c.req.valid('json'));
      return c.json(response, created ? 201 : 200);
    })
    .get('/people', async (c) => c.json(await friends.listPeople(c.var.user.id)));
}
