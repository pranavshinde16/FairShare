// The authorization matrix (Blueprint 9.1, 10.4): every API route × {signed out, outsider, member
// who left, member, owner}, each against a fresh group. Non-members and former members get 404,
// so IDs can't be probed. A last check fails if a route is added without a row here.

import { Group, InviteCreated, type CreateExpense } from '@fairshare/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from './lib/ids';
import { integrationApp } from './testing/integration';

// The per-user limit is tested in rate-limits.test.ts; this file makes hundreds of requests.
const ctx = await integrationApp({ userLimiter: { consume: () => ({ allowed: true }) } });
afterAll(() => ctx.drop());

const owner = await ctx.person('owner@example.com');
const member = await ctx.person('member@example.com');
const former = await ctx.person('former@example.com');
const outsider = await ctx.person('outsider@example.com');

const actors = { signedOut: null, outsider, former, member, owner } as const;
type Actor = keyof typeof actors;
const ACTORS = Object.keys(actors) as Actor[];
const idOf = (actor: Actor) => actors[actor]?.id ?? uuidv7();

const expense = (id: string, payer: string): CreateExpense => ({
  id,
  description: 'Matrix',
  amount: 1000,
  currency: 'INR',
  occurredOn: '2026-11-10',
  payers: [{ userId: payer, amount: 1000 }],
  // Only the payer shares it, so every balance stays zero and the group can still be deleted.
  split: { method: 'equal', participants: [payer] },
});

/**
 * A fresh group: the owner, a member, a member who left, a placeholder, a placeholder whose email
 * hint is the outsider's (so only the outsider can claim it), an invite by the owner, a live
 * expense (version 1) and a deleted one (version 2).
 */
async function freshGroup() {
  const id = uuidv7();
  const created = await ctx.call(owner, 'POST', '/api/v1/groups', {
    id,
    name: 'Matrix',
    currency: 'INR',
    members: [{ name: 'Placeholder' }, { name: 'Hint', email: outsider.email }],
  });
  expect(created.status).toBe(201);
  const members = Group.parse(created.body).members;
  const invite = InviteCreated.parse(
    (await ctx.call(owner, 'POST', `/api/v1/groups/${id}/invites`, {})).body,
  );
  const token = invite.url.split('/').pop()!;
  for (const who of [member, former]) {
    expect((await ctx.call(who, 'POST', `/api/v1/invites/${token}/accept`, {})).status).toBe(200);
  }
  expect((await ctx.call(former, 'DELETE', `/api/v1/groups/${id}/members/me`)).status).toBe(204);

  const live = uuidv7();
  const deleted = uuidv7();
  for (const tx of [live, deleted]) {
    const res = await ctx.call(
      owner,
      'POST',
      `/api/v1/groups/${id}/expenses`,
      expense(tx, owner.id),
    );
    expect(res.status).toBe(201);
  }
  const del = await ctx.request(`/api/v1/transactions/${deleted}`, {
    method: 'DELETE',
    cookie: owner.cookie,
    headers: { 'If-Match': '"1"' },
  });
  expect(del.status).toBe(200);

  return {
    id,
    token,
    inviteId: invite.id,
    placeholderId: members.find((m) => m.user.name === 'Placeholder')!.user.id,
    hintId: members.find((m) => m.user.name === 'Hint')!.user.id,
    live,
    deleted,
  };
}

type Setup = Awaited<ReturnType<typeof freshGroup>>;
type Row = {
  /** The route as the app registers it, e.g. "GET /api/v1/groups/:groupId". */
  route: string;
  /** What this row does, when one route has several rows. */
  case?: string;
  path: (g: Setup) => string;
  body?: (g: Setup, actor: Actor) => unknown;
  ifMatch?: number;
  expected: Record<Actor, number>;
};

/** Expected statuses: signed out → 401, then outsider, former, member, owner. */
const s = (outsider: number, former: number, member: number, owner: number) => ({
  signedOut: 401,
  outsider,
  former,
  member,
  owner,
});
/** A group's own data: members only. */
const members = (ok: number) => s(404, 404, ok, ok);
/** Only the owner may. */
const ownerOnly = (ok: number) => s(404, 404, 403, ok);
/** Anyone signed in, about themselves. */
const anyone = (ok: number) => s(ok, ok, ok, ok);

const MATRIX: Row[] = [
  // Groups.
  { route: 'GET /api/v1/groups', path: () => '/api/v1/groups', expected: anyone(200) },
  {
    route: 'POST /api/v1/groups',
    path: () => '/api/v1/groups',
    body: () => ({ id: uuidv7(), name: 'Mine', currency: 'INR' }),
    expected: anyone(201),
  },
  {
    route: 'GET /api/v1/groups/:groupId',
    path: (g) => `/api/v1/groups/${g.id}`,
    expected: members(200),
  },
  {
    route: 'PATCH /api/v1/groups/:groupId',
    path: (g) => `/api/v1/groups/${g.id}`,
    body: () => ({ name: 'Renamed' }),
    expected: members(200),
  },
  {
    route: 'DELETE /api/v1/groups/:groupId',
    path: (g) => `/api/v1/groups/${g.id}`,
    expected: ownerOnly(204),
  },
  {
    route: 'POST /api/v1/groups/:groupId/members',
    path: (g) => `/api/v1/groups/${g.id}/members`,
    body: () => ({ name: 'New person' }),
    expected: members(201),
  },
  {
    route: 'DELETE /api/v1/groups/:groupId/members/:userId',
    case: 'remove someone else',
    path: (g) => `/api/v1/groups/${g.id}/members/${g.placeholderId}`,
    expected: ownerOnly(204),
  },
  {
    route: 'DELETE /api/v1/groups/:groupId/members/:userId',
    case: 'leave',
    path: (g) => `/api/v1/groups/${g.id}/members/me`,
    expected: members(204),
  },
  {
    route: 'POST /api/v1/groups/:groupId/invites',
    path: (g) => `/api/v1/groups/${g.id}/invites`,
    body: () => ({}),
    expected: members(201),
  },
  {
    route: 'DELETE /api/v1/groups/:groupId/invites/:inviteId',
    case: 'revoke the owner’s invite',
    path: (g) => `/api/v1/groups/${g.id}/invites/${g.inviteId}`,
    expected: ownerOnly(204),
  },

  // Transactions in a group.
  {
    route: 'GET /api/v1/groups/:groupId/transactions',
    path: (g) => `/api/v1/groups/${g.id}/transactions`,
    expected: members(200),
  },
  {
    route: 'POST /api/v1/groups/:groupId/expenses',
    path: (g) => `/api/v1/groups/${g.id}/expenses`,
    body: (_, actor) => expense(uuidv7(), idOf(actor)),
    expected: members(201),
  },
  {
    route: 'POST /api/v1/groups/:groupId/settlements',
    path: (g) => `/api/v1/groups/${g.id}/settlements`,
    body: () => ({
      id: uuidv7(),
      fromUserId: member.id,
      toUserId: owner.id,
      amount: 500,
      currency: 'INR',
      occurredOn: '2026-11-11',
      method: 'cash',
    }),
    expected: members(201),
  },
  {
    route: 'GET /api/v1/groups/:groupId/balances',
    path: (g) => `/api/v1/groups/${g.id}/balances`,
    expected: members(200),
  },
  {
    route: 'GET /api/v1/groups/:groupId/activity',
    path: (g) => `/api/v1/groups/${g.id}/activity`,
    expected: members(200),
  },

  // One transaction, found by its ID alone: its group's membership decides.
  {
    route: 'GET /api/v1/transactions/:id',
    path: (g) => `/api/v1/transactions/${g.live}`,
    expected: members(200),
  },
  {
    route: 'PUT /api/v1/transactions/:id',
    path: (g) => `/api/v1/transactions/${g.live}`,
    ifMatch: 1,
    body: () => {
      const { id: _, ...update } = expense(uuidv7(), owner.id);
      return { ...update, description: 'Edited' };
    },
    expected: members(200),
  },
  {
    route: 'DELETE /api/v1/transactions/:id',
    path: (g) => `/api/v1/transactions/${g.live}`,
    ifMatch: 1,
    expected: members(200),
  },
  {
    route: 'POST /api/v1/transactions/:id/restore',
    path: (g) => `/api/v1/transactions/${g.deleted}/restore`,
    ifMatch: 2,
    expected: members(200),
  },
  {
    route: 'GET /api/v1/transactions/:id/history',
    path: (g) => `/api/v1/transactions/${g.live}/history`,
    expected: members(200),
  },

  // Invites. The preview is public; accepting is anyone signed in (that's what a link is for).
  {
    route: 'GET /api/v1/invites/:token',
    path: (g) => `/api/v1/invites/${g.token}`,
    expected: { ...anyone(200), signedOut: 200 },
  },
  {
    route: 'POST /api/v1/invites/:token/accept',
    path: (g) => `/api/v1/invites/${g.token}/accept`,
    body: () => ({}),
    // Already in the group: 409 ALREADY_MEMBER, not a second membership.
    expected: s(200, 200, 409, 409),
  },

  // Claims: only the person whose email the placeholder's hint is.
  { route: 'GET /api/v1/claims', path: () => '/api/v1/claims', expected: anyone(200) },
  {
    route: 'POST /api/v1/claims/:placeholderId',
    path: (g) => `/api/v1/claims/${g.hintId}`,
    expected: s(200, 404, 404, 404),
  },
  {
    route: 'DELETE /api/v1/claims/:placeholderId',
    path: (g) => `/api/v1/claims/${g.hintId}`,
    expected: s(204, 404, 404, 404),
  },

  // People, friends and balances: only people I share an active group with.
  { route: 'GET /api/v1/people', path: () => '/api/v1/people', expected: anyone(200) },
  { route: 'GET /api/v1/friends', path: () => '/api/v1/friends', expected: anyone(200) },
  {
    route: 'GET /api/v1/friends/:userId',
    path: (g) => `/api/v1/friends/${g.placeholderId}`,
    expected: members(200),
  },
  {
    route: 'POST /api/v1/friends',
    path: () => '/api/v1/friends',
    body: (g) => ({ userId: g.placeholderId }),
    // Not someone the outsider or former member shares a group with: a validation error, which
    // looks the same as for someone who doesn't exist.
    expected: s(400, 400, 201, 201),
  },
  { route: 'GET /api/v1/home', path: () => '/api/v1/home', expected: anyone(200) },

  // Activity, profile and reference data: always my own.
  { route: 'GET /api/v1/activity', path: () => '/api/v1/activity', expected: anyone(200) },
  {
    route: 'POST /api/v1/activity/seen',
    path: () => '/api/v1/activity/seen',
    expected: anyone(204),
  },
  { route: 'GET /api/v1/me', path: () => '/api/v1/me', expected: anyone(200) },
  { route: 'PATCH /api/v1/me', path: () => '/api/v1/me', body: () => ({}), expected: anyone(200) },
  { route: 'GET /api/v1/currencies', path: () => '/api/v1/currencies', expected: anyone(200) },
  {
    route: 'GET /api/v1/sign-in-options',
    path: () => '/api/v1/sign-in-options',
    expected: { ...anyone(200), signedOut: 200 },
  },
];

describe('every route × every kind of caller', () => {
  for (const row of MATRIX) {
    for (const actor of ACTORS) {
      const expected = row.expected[actor];
      it(`${row.route}${row.case ? ` (${row.case})` : ''}: ${actor} → ${expected}`, async () => {
        const g = await freshGroup();
        const [method] = row.route.split(' ') as [
          NonNullable<Parameters<typeof ctx.request>[1]>['method'],
        ];
        const res = await ctx.request(row.path(g), {
          method,
          cookie: actors[actor]?.cookie,
          body: row.body?.(g, actor),
          headers: row.ifMatch ? { 'If-Match': `"${row.ifMatch}"` } : {},
        });
        expect(res.status, await res.text()).toBe(expected);
      });
    }
  }
});

describe('DELETE /api/v1/me', () => {
  // Kept apart: it ends the account, so each case gets a person of its own.
  it('needs a session', async () => {
    const res = await ctx.request('/api/v1/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
    expect(res.status).toBe(401);
  });

  it('deletes only the caller’s own account', async () => {
    const leaving = await ctx.person('leaving@example.com');
    const res = await ctx.request('/api/v1/me', {
      method: 'DELETE',
      cookie: leaving.cookie,
      body: { confirm: 'DELETE' },
    });
    expect(res.status).toBe(204);
    expect((await ctx.request('/api/v1/me', { cookie: leaving.cookie })).status).toBe(401);
    expect((await ctx.request('/api/v1/me', { cookie: owner.cookie })).status).toBe(200);
  });
});

describe('IDs', () => {
  it('answer 404 for a malformed or unknown group or transaction ID, even to a member', async () => {
    for (const id of ['not-a-uuid', uuidv7()]) {
      expect((await ctx.call(member, 'GET', `/api/v1/groups/${id}`)).status).toBe(404);
      expect((await ctx.call(member, 'GET', `/api/v1/transactions/${id}`)).status).toBe(404);
    }
  });

  it('answer 404 for a deleted group, even to its former owner', async () => {
    const g = await freshGroup();
    await ctx.call(owner, 'DELETE', `/api/v1/groups/${g.id}`);
    expect((await ctx.call(owner, 'GET', `/api/v1/groups/${g.id}`)).status).toBe(404);
    expect((await ctx.call(owner, 'GET', `/api/v1/transactions/${g.live}`)).status).toBe(404);
  });
});

describe('the matrix', () => {
  it('has a row for every route the API serves', () => {
    const served = new Set(
      ctx.app.routes
        .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/v1/'))
        .map((r) => `${r.method} ${r.path}`),
    );
    const covered = new Set([...MATRIX.map((row) => row.route), 'DELETE /api/v1/me']);
    expect([...served].filter((route) => !covered.has(route))).toEqual([]);
    expect([...covered].filter((route) => !served.has(route))).toEqual([]);
  });
});
