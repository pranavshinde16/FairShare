import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('health() calls the endpoint and returns the validated body', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(200, { ok: true, db: 'up' }));
    const api = createApiClient({ baseUrl: 'https://example.test', fetch });

    await expect(api.health()).resolves.toEqual({ ok: true, db: 'up' });
    expect(fetch).toHaveBeenCalledWith(
      'https://example.test/api/health',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('health() passes the abort signal through', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(200, { ok: true, db: 'up' }));
    const controller = new AbortController();
    await createApiClient({ baseUrl: '', fetch }).health(controller.signal);
    expect(fetch.mock.calls[0]![1]!.signal).toBe(controller.signal);
  });

  it('reports a database outage as a 503 ApiError', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(503, { ok: false, db: 'down' }));
    const err = await createApiClient({ baseUrl: '', fetch })
      .health()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 503 });
  });

  it('rejects a response that does not match the contract', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, { ok: 'yes' }));
    await expect(createApiClient({ baseUrl: '', fetch }).health()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('profile and reference endpoints', () => {
  const profile = {
    id: '01900000-0000-7000-8000-00000000000a',
    name: 'Asha',
    email: 'asha@example.com',
    avatarUrl: null,
    defaultCurrency: 'INR',
    upiVpa: null,
    createdAt: '2026-11-01T08:00:00.000Z',
  };

  it('me() reads the profile', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, profile));

    await expect(createApiClient({ baseUrl: '', fetch }).me()).resolves.toEqual(profile);
    expect(fetch).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ method: 'GET' }));
  });

  it('updateMe() sends a JSON PATCH and returns the updated profile', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json(200, { ...profile, name: 'Asha K' }));

    await expect(
      createApiClient({ baseUrl: '', fetch }).updateMe({ name: 'Asha K' }),
    ).resolves.toMatchObject({ name: 'Asha K' });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"name":"Asha K"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('signInOptions() and currencies() read their endpoints', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { google: false }))
      .mockResolvedValueOnce(json(200, { items: [{ code: 'INR', minorUnits: 2, symbol: '₹' }] }));
    const api = createApiClient({ baseUrl: '', fetch });

    await expect(api.signInOptions()).resolves.toEqual({ google: false });
    await expect(api.currencies()).resolves.toEqual({
      items: [{ code: 'INR', minorUnits: 2, symbol: '₹' }],
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/sign-in-options',
      '/api/v1/currencies',
    ]);
  });

  it('turns a 401 into an UNAUTHENTICATED ApiError', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(401, {
        error: { code: 'UNAUTHENTICATED', message: 'Sign in first.', requestId: 'r1' },
      }),
    );
    await expect(createApiClient({ baseUrl: '', fetch }).me()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      requestId: 'r1',
    });
  });
});

describe('group, invite, friend and claim endpoints', () => {
  const ok = (body: unknown = null, status = 200) =>
    body === null ? new Response(null, { status: 204 }) : json(status, body);

  it('send each request to its path and method', async () => {
    const group = {
      kind: 'group',
      id: '01900000-0000-7000-8000-000000000100',
      name: 'Goa',
      emoji: null,
      currency: 'INR',
      createdAt: '2026-11-01T08:00:00.000Z',
      members: [],
      myRole: 'owner',
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      const path = url as string;
      if (path.endsWith('/members/me') || path.includes('/invites/inv') || path.endsWith('/g1')) {
        return Promise.resolve(ok());
      }
      if (path.endsWith('/accept')) return Promise.resolve(ok({ groupId: group.id }));
      return Promise.resolve(ok(group, 201));
    });
    const api = createApiClient({ baseUrl: '', fetch });

    await api.createGroup({ id: group.id, name: 'Goa', currency: 'INR' });
    await api.removeMember('g1', 'me');
    await api.revokeInvite('g1', 'inv');
    await api.acceptInvite('tok/../x', { claimPlaceholderId: group.id });
    await api.deleteGroup('g1');

    expect(fetch.mock.calls.map(([url, init]) => [init?.method, url])).toEqual([
      ['POST', '/api/v1/groups'],
      ['DELETE', '/api/v1/groups/g1/members/me'],
      ['DELETE', '/api/v1/groups/g1/invites/inv'],
      ['POST', '/api/v1/invites/tok%2F..%2Fx/accept'],
      ['DELETE', '/api/v1/groups/g1'],
    ]);
  });

  it('validate list responses against their contracts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { items: [] }))
      .mockResolvedValueOnce(json(200, { items: [{ id: 'not-a-uuid' }] }));
    const api = createApiClient({ baseUrl: '', fetch });

    await expect(api.friends()).resolves.toEqual({ items: [] });
    await expect(api.people()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('every endpoint method', () => {
  const ID = '01900000-0000-7000-8000-000000000100';
  const OTHER = '01900000-0000-7000-8000-000000000200';
  const USER = { id: ID, name: 'Asha', avatarUrl: null, isPlaceholder: false, isDeleted: false };
  const MEMBER = { user: USER, role: 'owner', joinedAt: '2026-11-01T08:00:00.000Z', leftAt: null };
  const GROUP = {
    kind: 'group',
    id: ID,
    name: 'Goa',
    emoji: null,
    currency: 'INR',
    createdAt: '2026-11-01T08:00:00.000Z',
    members: [MEMBER],
    myRole: 'owner',
  };
  const TOKEN = 'A'.repeat(43);
  const NEW_EXPENSE = {
    id: ID,
    description: 'Dinner',
    amount: 1000,
    currency: 'INR',
    occurredOn: '2026-11-01',
    payers: [{ userId: ID, amount: 1000 }],
    split: { method: 'equal' as const, participants: [ID] },
  };
  const { id: _, ...EDIT } = NEW_EXPENSE;
  const { split: _split, ...EXPENSE_FIELDS } = EDIT;
  const EXPENSE = {
    ...EXPENSE_FIELDS,
    id: ID,
    groupId: ID,
    type: 'expense',
    notes: null,
    splitMethod: 'equal',
    splitInput: NEW_EXPENSE.split,
    shares: [{ userId: ID, amount: 1000 }],
    paymentMethod: null,
    paymentRef: null,
    createdBy: USER,
    updatedBy: null,
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: null,
    deletedAt: null,
    version: 3,
    myNet: 0,
  };

  const NEW_SETTLEMENT = {
    id: ID,
    fromUserId: ID,
    toUserId: OTHER,
    amount: 1000,
    currency: 'INR',
    occurredOn: '2026-11-01',
    method: 'upi' as const,
  };
  const { id: _settlementId, ...SETTLEMENT_EDIT } = NEW_SETTLEMENT;
  const SETTLEMENT = {
    ...EXPENSE,
    type: 'settlement',
    description: 'Settlement',
    splitMethod: null,
    splitInput: null,
    payers: [{ userId: ID, amount: 1000 }],
    shares: [{ userId: OTHER, amount: 1000 }],
    paymentMethod: 'upi',
    paymentRef: null,
    myNet: 1000,
  };

  type Case = [
    string,
    (api: ReturnType<typeof createApiClient>) => Promise<unknown>,
    string,
    string,
    unknown?,
    unknown?,
    string?,
  ];
  const CASES: Case[] = [
    [
      'groups',
      (api) => api.groups(),
      'GET',
      '/api/v1/groups',
      { items: [{ ...GROUP, myNet: [] }] },
    ],
    ['group', (api) => api.group(ID), 'GET', `/api/v1/groups/${ID}`, GROUP],
    [
      'createGroup',
      (api) => api.createGroup({ id: ID, name: 'Goa', currency: 'INR' }),
      'POST',
      '/api/v1/groups',
      GROUP,
      { id: ID, name: 'Goa', currency: 'INR' },
    ],
    [
      'updateGroup',
      (api) => api.updateGroup(ID, { name: 'Goa 2' }),
      'PATCH',
      `/api/v1/groups/${ID}`,
      GROUP,
      { name: 'Goa 2' },
    ],
    ['deleteMe', (api) => api.deleteMe(), 'DELETE', '/api/v1/me', undefined, { confirm: 'DELETE' }],
    ['deleteGroup', (api) => api.deleteGroup(ID), 'DELETE', `/api/v1/groups/${ID}`],
    [
      'addMember',
      (api) => api.addMember(ID, { name: 'Bilal' }),
      'POST',
      `/api/v1/groups/${ID}/members`,
      MEMBER,
      { name: 'Bilal' },
    ],
    [
      'removeMember',
      (api) => api.removeMember(ID, ID),
      'DELETE',
      `/api/v1/groups/${ID}/members/${ID}`,
    ],
    [
      'createInvite',
      (api) => api.createInvite(ID),
      'POST',
      `/api/v1/groups/${ID}/invites`,
      { id: ID, url: `https://app/invite/${TOKEN}`, expiresAt: '2026-12-01T00:00:00.000Z' },
      {},
    ],
    [
      'revokeInvite',
      (api) => api.revokeInvite(ID, ID),
      'DELETE',
      `/api/v1/groups/${ID}/invites/${ID}`,
    ],
    [
      'invitePreview',
      (api) => api.invitePreview(TOKEN),
      'GET',
      `/api/v1/invites/${TOKEN}`,
      {
        group: { name: 'Goa', emoji: null, memberCount: 2 },
        invitedBy: { name: 'Asha' },
        placeholders: [],
        targetPlaceholderId: null,
        expired: false,
      },
    ],
    [
      'acceptInvite',
      (api) => api.acceptInvite(TOKEN),
      'POST',
      `/api/v1/invites/${TOKEN}/accept`,
      { groupId: ID },
      {},
    ],
    [
      'home',
      (api) => api.home(),
      'GET',
      '/api/v1/home',
      {
        totals: [],
        groups: [{ group: GROUP, myNet: [], lastActivityAt: GROUP.createdAt }],
        people: [],
      },
    ],
    [
      'groupBalances',
      (api) => api.groupBalances(ID),
      'GET',
      `/api/v1/groups/${ID}/balances`,
      {
        balances: [{ currency: 'INR', nets: [{ userId: ID, amount: 0 }], transfers: [] }],
        me: { net: [], owes: [], owed: [] },
        breakdown: [
          {
            userId: ID,
            paid: { amount: 0, currency: 'INR' },
            share: { amount: 0, currency: 'INR' },
            sent: { amount: 0, currency: 'INR' },
            received: { amount: 0, currency: 'INR' },
          },
        ],
      },
    ],
    ['friends', (api) => api.friends(), 'GET', '/api/v1/friends', { items: [] }],
    [
      'friend',
      (api) => api.friend(ID),
      'GET',
      `/api/v1/friends/${ID}`,
      {
        user: USER,
        directGroupId: null,
        total: [{ amount: -500, currency: 'INR' }],
        breakdown: [
          {
            groupId: ID,
            groupName: 'Goa',
            kind: 'group',
            balance: { amount: -500, currency: 'INR' },
          },
        ],
      },
    ],
    [
      'addFriend',
      (api) => api.addFriend({ userId: ID }),
      'POST',
      '/api/v1/friends',
      { groupId: ID, friend: USER },
      { userId: ID },
    ],
    ['people', (api) => api.people(), 'GET', '/api/v1/people', { items: [USER] }],
    [
      'transactions',
      (api) => api.transactions(ID, { limit: 2, q: 'taxi' }),
      'GET',
      `/api/v1/groups/${ID}/transactions?limit=2&q=taxi`,
      { items: [EXPENSE], nextCursor: null },
    ],
    [
      'createExpense',
      (api) => api.createExpense(ID, NEW_EXPENSE),
      'POST',
      `/api/v1/groups/${ID}/expenses`,
      EXPENSE,
      NEW_EXPENSE,
    ],
    [
      'createSettlement',
      (api) => api.createSettlement(ID, NEW_SETTLEMENT),
      'POST',
      `/api/v1/groups/${ID}/settlements`,
      SETTLEMENT,
      NEW_SETTLEMENT,
    ],
    [
      'updateSettlement',
      (api) => api.updateSettlement(ID, 3, SETTLEMENT_EDIT),
      'PUT',
      `/api/v1/transactions/${ID}`,
      SETTLEMENT,
      SETTLEMENT_EDIT,
      '"3"',
    ],
    ['transaction', (api) => api.transaction(ID), 'GET', `/api/v1/transactions/${ID}`, EXPENSE],
    [
      'updateExpense',
      (api) => api.updateExpense(ID, 3, EDIT),
      'PUT',
      `/api/v1/transactions/${ID}`,
      EXPENSE,
      EDIT,
      '"3"',
    ],
    [
      'deleteTransaction',
      (api) => api.deleteTransaction(ID, 3),
      'DELETE',
      `/api/v1/transactions/${ID}`,
      { id: ID, version: 4, deletedAt: '2026-11-02T00:00:00.000Z' },
      undefined,
      '"3"',
    ],
    [
      'restoreTransaction',
      (api) => api.restoreTransaction(ID, 4),
      'POST',
      `/api/v1/transactions/${ID}/restore`,
      EXPENSE,
      undefined,
      '"4"',
    ],
    [
      'transactionHistory',
      (api) => api.transactionHistory(ID),
      'GET',
      `/api/v1/transactions/${ID}/history`,
      { items: [] },
    ],
    [
      'activity',
      (api) => api.activity({ limit: 20, cursor: 'MTI' }),
      'GET',
      '/api/v1/activity?limit=20&cursor=MTI',
      { items: [], nextCursor: null, unreadCount: 2, people: [USER] },
    ],
    [
      'groupActivity',
      (api) => api.groupActivity(ID),
      'GET',
      `/api/v1/groups/${ID}/activity`,
      { items: [], nextCursor: null, unreadCount: 0, people: [] },
    ],
    ['markActivitySeen', (api) => api.markActivitySeen(), 'POST', '/api/v1/activity/seen'],
    ['claims', (api) => api.claims(), 'GET', '/api/v1/claims', { items: [] }],
    ['claim', (api) => api.claim(ID), 'POST', `/api/v1/claims/${ID}`, { groupIds: [ID] }],
    ['dismissClaim', (api) => api.dismissClaim(ID), 'DELETE', `/api/v1/claims/${ID}`],
  ];

  for (const [name, call, method, path, response, body, ifMatch] of CASES) {
    it(`${name}() → ${method} ${path}`, async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(
          response === undefined ? new Response(null, { status: 204 }) : json(200, response),
        );

      const result = await call(createApiClient({ baseUrl: '', fetch }));

      const [url, init] = fetch.mock.calls[0]!;
      expect([init?.method, url]).toEqual([method, path]);
      expect(init?.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body);
      expect((init?.headers as Record<string, string>)['If-Match']).toBe(ifMatch);
      expect(result).toEqual(response);
    });
  }
});
