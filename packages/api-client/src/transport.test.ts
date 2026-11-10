import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from './errors';
import { createTransport } from './transport';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const Thing = z.object({ id: z.string(), version: z.int() });

/** A transport whose fetch answers with `response`, plus the recorded call. */
function setup(response: Response | Error = json(200, { id: 't1', version: 2 })) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  if (response instanceof Error) fetch.mockRejectedValue(response);
  else fetch.mockResolvedValue(response);
  const transport = createTransport({ baseUrl: 'https://api.test', fetch });
  const call = () => {
    const [url, init] = fetch.mock.calls[0]!;
    return { url: url as string, init: init!, headers: init!.headers as Record<string, string> };
  };
  return { ...transport, fetch, call };
}

describe('request', () => {
  it('GETs with cookies and returns the validated body', async () => {
    const t = setup();
    await expect(t.request(Thing, '/api/v1/things/t1')).resolves.toEqual({ id: 't1', version: 2 });
    const { url, init, headers } = t.call();
    expect(url).toBe('https://api.test/api/v1/things/t1');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', body: undefined });
    expect(headers).toEqual({ Accept: 'application/json' });
  });

  it('sends a JSON body with its content type', async () => {
    const t = setup(json(201, { id: 't1', version: 1 }));
    await t.request(Thing, '/api/v1/things', {
      method: 'POST',
      body: { name: 'Dinner', amount: 120000 },
    });
    const { init, headers } = t.call();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Dinner","amount":120000}');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends If-Match with the quoted version', async () => {
    const t = setup();
    await t.request(Thing, '/api/v1/transactions/t1', { method: 'PUT', body: {}, ifMatch: 2 });
    expect(t.call().headers['If-Match']).toBe('"2"');
  });

  it('omits If-Match when no version is given', async () => {
    const t = setup();
    await t.request(Thing, '/x', { method: 'POST', body: {} });
    expect(t.call().headers).not.toHaveProperty('If-Match');
  });

  it('builds the query string, skipping empty values', async () => {
    const t = setup();
    await t.request(Thing, '/api/v1/groups/g/transactions', {
      query: {
        limit: 20,
        q: 'dinner & drinks',
        includeDeleted: true,
        cursor: undefined,
        person: null,
      },
    });
    expect(t.call().url).toBe(
      'https://api.test/api/v1/groups/g/transactions?limit=20&q=dinner+%26+drinks&includeDeleted=true',
    );
  });

  it('adds no "?" when every query value is empty', async () => {
    const t = setup();
    await t.request(Thing, '/x', { query: { cursor: undefined } });
    expect(t.call().url).toBe('https://api.test/x');
  });

  it('turns a contract mismatch into INVALID_RESPONSE with the zod issues', async () => {
    const t = setup(json(200, { id: 't1', version: 'two' }));
    const err = await t.request(Thing, '/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, code: 'INVALID_RESPONSE' });
    expect((err as ApiError).details).toEqual([expect.objectContaining({ path: ['version'] })]);
  });

  it('turns a non-JSON success body into INVALID_RESPONSE', async () => {
    const t = setup(new Response('<html>', { status: 200 }));
    await expect(t.request(Thing, '/x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('throws the server’s error as an ApiError', async () => {
    const t = setup(
      json(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Changed',
          details: { currentVersion: 3 },
          requestId: 'r1',
        },
      }),
    );
    await expect(t.request(Thing, '/x', { method: 'PUT', ifMatch: 2 })).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      details: { currentVersion: 3 },
      requestId: 'r1',
    });
  });

  it('reports network failures with status 0', async () => {
    const t = setup(new TypeError('Failed to fetch'));
    await expect(t.request(Thing, '/x')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('rethrows an abort unchanged, so callers can ignore cancelled requests', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const t = setup(abort);
    const err = await t
      .request(Thing, '/x', { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(err).toBe(abort);
    expect(t.call().init.signal).toBe(controller.signal);
  });
});

describe('requestNoContent', () => {
  it('resolves on 204 without reading a body', async () => {
    const t = setup(new Response(null, { status: 204 }));
    await expect(
      t.requestNoContent('/api/v1/groups/g', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
    expect(t.call().init.method).toBe('DELETE');
  });

  it('still throws on errors', async () => {
    const t = setup(json(409, { error: { code: 'BALANCE_NOT_ZERO', message: 'Settle up first' } }));
    await expect(t.requestNoContent('/x', { method: 'DELETE' })).rejects.toMatchObject({
      code: 'BALANCE_NOT_ZERO',
    });
  });
});

describe('default fetch', () => {
  it('uses globalThis.fetch, bound so browsers don’t throw "Illegal invocation"', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(json(200, { id: 't1', version: 1 }));
    });
    try {
      await expect(createTransport({ baseUrl: '' }).request(Thing, '/x')).resolves.toEqual({
        id: 't1',
        version: 1,
      });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
