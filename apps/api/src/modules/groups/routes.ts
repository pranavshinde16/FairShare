import { AddMember, CreateGroup, CreateInvite, UpdateGroup, Uuid } from '@fairshare/contracts';
import { Hono } from 'hono';
import type { AuthedEnv } from '../../http/context';
import { validate } from '../../http/validate';
import type { InvitesService } from '../invites/service';
import { groupTransactionsRoutes } from '../transactions/routes';
import type { TransactionsService } from '../transactions/service';
import { requireMembership, type GroupEnv } from './membership';
import { notFound, type GroupsService } from './service';

/** Groups, their members and their invites. */
export function groupsRoutes(
  groups: GroupsService,
  invites: InvitesService,
  transactions: TransactionsService,
) {
  const scoped = new Hono<GroupEnv>()
    .use(requireMembership(groups))
    .get('/', async (c) => c.json(await groups.getGroup(c.var.membership.groupId, c.var.user.id)))
    .patch('/', validate('json', UpdateGroup), async (c) =>
      c.json(await groups.updateGroup(c.var.user.id, c.var.membership, c.req.valid('json'))),
    )
    .delete('/', async (c) => {
      await groups.deleteGroup(c.var.user.id, c.var.membership);
      return c.body(null, 204);
    })
    .post('/members', validate('json', AddMember), async (c) =>
      c.json(await groups.addMember(c.var.user.id, c.var.membership, c.req.valid('json')), 201),
    )
    // :userId may be "me" to leave.
    .delete('/members/:userId', async (c) => {
      const param = c.req.param('userId');
      const userId = param === 'me' ? c.var.user.id : Uuid.safeParse(param).data?.toLowerCase();
      if (!userId) throw notFound('This person isn’t in the group.');
      await groups.removeMember(c.var.user.id, c.var.membership, userId);
      return c.body(null, 204);
    })
    .post('/invites', validate('json', CreateInvite), async (c) =>
      c.json(await invites.createInvite(c.var.user.id, c.var.membership, c.req.valid('json')), 201),
    )
    .route('/', groupTransactionsRoutes(transactions))
    .delete('/invites/:inviteId', async (c) => {
      const inviteId = Uuid.safeParse(c.req.param('inviteId'));
      if (!inviteId.success) throw notFound('No such invite in this group.');
      await invites.revokeInvite(c.var.user.id, c.var.membership, inviteId.data);
      return c.body(null, 204);
    });

  return new Hono<AuthedEnv>()
    .post('/groups', validate('json', CreateGroup), async (c) => {
      const { group, created } = await groups.createGroup(c.var.user.id, c.req.valid('json'));
      return c.json(group, created ? 201 : 200);
    })
    .get('/groups', async (c) => c.json(await groups.listGroups(c.var.user.id)))
    .route('/groups/:groupId', scoped);
}
