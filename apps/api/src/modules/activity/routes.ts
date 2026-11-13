import { ActivityListQuery } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import type { GroupEnv } from '../groups/membership';
import type { ActivityService } from './service';

/** The Activity tab: my feed, and marking it seen. */
export function activityRoutes(activity: ActivityService) {
  return new Hono<AuthedEnv>()
    .get('/activity', validate('query', ActivityListQuery), async (c) =>
      c.json(await activity.feed(c.var.user.id, c.req.valid('query'))),
    )
    .post('/activity/seen', async (c) => {
      await activity.markSeen(c.var.user.id);
      return c.body(null, 204);
    });
}

/** Under /groups/:groupId, behind requireMembership. */
export function groupActivityRoutes(activity: ActivityService) {
  return new Hono<GroupEnv>().get('/activity', validate('query', ActivityListQuery), async (c) =>
    c.json(await activity.groupFeed(c.var.user.id, c.var.membership, c.req.valid('query'))),
  );
}
