import { Uuid } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { AppError } from '../../http/errors';
import type { GroupEnv } from '../groups/membership';
import type { BalancesService } from './service';

/** Under /groups/:groupId, behind requireMembership. */
export function groupBalancesRoutes(balances: BalancesService) {
  return new Hono<GroupEnv>().get('/balances', async (c) =>
    c.json(await balances.groupBalances(c.var.user.id, c.var.membership)),
  );
}

/** Home and the friend list and page. */
export function balancesRoutes(balances: BalancesService) {
  return new Hono<AuthedEnv>()
    .get('/home', async (c) => c.json(await balances.home(c.var.user.id)))
    .get('/friends', async (c) => c.json(await balances.listFriends(c.var.user.id)))
    .get('/friends/:userId', async (c) => {
      const userId = Uuid.safeParse(c.req.param('userId'));
      if (!userId.success) {
        throw new AppError('NOT_FOUND', 'You don’t share a group with this person.');
      }
      return c.json(await balances.friend(c.var.user.id, userId.data));
    });
}
