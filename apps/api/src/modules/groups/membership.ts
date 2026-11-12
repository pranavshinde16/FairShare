import { Uuid } from '@fairshare/contracts';
import type { MiddlewareHandler } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { notFound, type GroupsService, type Membership } from './service';

/** Routes under /groups/:groupId, where the caller is known to be an active member. */
export type GroupEnv = { Variables: AuthedEnv['Variables'] & { membership: Membership } };

/**
 * The single authorization check for group routes (Blueprint 9.1): an active membership in a
 * group that isn't deleted. Anything else, a malformed ID included, is 404, so IDs can't be probed.
 */
export function requireMembership(groups: GroupsService): MiddlewareHandler<GroupEnv> {
  return async (c, next) => {
    const groupId = Uuid.safeParse(c.req.param('groupId'));
    if (!groupId.success) throw notFound();
    const membership = await groups.membershipOf(groupId.data, c.var.user.id);
    if (!membership) throw notFound();
    c.set('membership', membership);
    await next();
  };
}
