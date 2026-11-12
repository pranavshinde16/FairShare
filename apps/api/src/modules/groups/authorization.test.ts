// The authorization matrix (Blueprint 9.1): every group route × {signed out, non-member, member who
// left, member, owner}. Non-members and former members get 404, so group IDs can't be probed.

import { Group, InviteCreated } from '@fairshare/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../lib/ids';
import { integrationApp } from '../../testing/integration';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

const owner = await ctx.person('owner@example.com');
const member = await ctx.person('member@example.com');
const former = await ctx.person('former@example.com');
const outsider = await ctx.person('outsider@example.com');

const actors = { signedOut: null, outsider, former, member, owner } as const;
type Actor = keyof typeof actors;

/** A fresh group: owner, member, a member who left, a placeholder and an invite by the owner. */
async function freshGroup() {
  const id = uuidv7();
  const created = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id,
    name: 'Matrix',
    currency: 'INR',
    members: [{ name: 'Placeholder' }],
  });
  const placeholderId = Group.parse(created.body).members[1]!.user.id;
  const invite = InviteCreated.parse(
    (await ctx.call(owner, 'POST', `/api/v1/groups/${id}/invites`, {})).body,
  );
  const token = invite.url.split('/').pop()!;
  for (const who of [member, former]) {
    expect((await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {})).status).toBe(200);
  }
  expect((await ctx.call(former, 'DELETE', `/api/v1/groups/${id}/members/me`)).status).toBe(204);
  return { id, placeholderId, inviteId: invite.id };
}

type Setup = Awaited<ReturnType<typeof freshGroup>>;
type Route = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: (g: Setup) => string;
  body?: unknown;
  expected: Record<Actor, number>;
};

const ROUTES: Route[] = [
  {
    name: 'read the group',
    method: 'GET',
    path: (g) => `/api/v1/groups/${g.id}`,
    expected: { signedOut: 401, outsider: 404, former: 404, member: 200, owner: 200 },
  },
  {
    name: 'rename it',
    method: 'PATCH',
    path: (g) => `/api/v1/groups/${g.id}`,
    body: { name: 'Renamed' },
    expected: { signedOut: 401, outsider: 404, former: 404, member: 200, owner: 200 },
  },
  {
    name: 'delete it',
    method: 'DELETE',
    path: (g) => `/api/v1/groups/${g.id}`,
    expected: { signedOut: 401, outsider: 404, former: 404, member: 403, owner: 204 },
  },
  {
    name: 'add a member',
    method: 'POST',
    path: (g) => `/api/v1/groups/${g.id}/members`,
    body: { name: 'New person' },
    expected: { signedOut: 401, outsider: 404, former: 404, member: 201, owner: 201 },
  },
  {
    name: 'remove someone else',
    method: 'DELETE',
    path: (g) => `/api/v1/groups/${g.id}/members/${g.placeholderId}`,
    expected: { signedOut: 401, outsider: 404, former: 404, member: 403, owner: 204 },
  },
  {
    name: 'leave',
    method: 'DELETE',
    path: (g) => `/api/v1/groups/${g.id}/members/me`,
    expected: { signedOut: 401, outsider: 404, former: 404, member: 204, owner: 204 },
  },
  {
    name: 'create an invite',
    method: 'POST',
    path: (g) => `/api/v1/groups/${g.id}/invites`,
    body: {},
    expected: { signedOut: 401, outsider: 404, former: 404, member: 201, owner: 201 },
  },
  {
    name: 'revoke the owner’s invite',
    method: 'DELETE',
    path: (g) => `/api/v1/groups/${g.id}/invites/${g.inviteId}`,
    expected: { signedOut: 401, outsider: 404, former: 404, member: 403, owner: 204 },
  },
];

describe('group routes', () => {
  for (const route of ROUTES) {
    for (const actor of Object.keys(actors) as Actor[]) {
      it(`${route.name}: ${actor} → ${route.expected[actor]}`, async () => {
        const group = await freshGroup();
        const res = await ctx.call(actors[actor], route.method, route.path(group), route.body);
        expect(res.status).toBe(route.expected[actor]);
      });
    }
  }

  it('answer 404 for a malformed or unknown group ID, even to a signed-in user', async () => {
    for (const id of ['not-a-uuid', uuidv7()]) {
      expect((await ctx.call(member, 'GET', `/api/v1/groups/${id}`)).status).toBe(404);
    }
  });

  it('answer 404 for a deleted group, even to its former owner', async () => {
    const group = await freshGroup();
    await ctx.call(owner, 'DELETE', `/api/v1/groups/${group.id}`);
    expect((await ctx.call(owner, 'GET', `/api/v1/groups/${group.id}`)).status).toBe(404);
  });
});
