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
