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
