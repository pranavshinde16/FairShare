import { ErrorEnvelope, HealthResponse } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { testApp } from './testing/app';

describe('GET /api/health', () => {
  it('returns 200 and a contract-shaped body when the database is up', async () => {
    const { app } = testApp();

    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({ ok: true, db: 'up' });
  });

  it('returns 503 when the database is down, so uptime checks notice', async () => {
    const { app } = testApp({ pingDatabase: () => Promise.resolve('down') });

    const res = await app.request('/api/health');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: 'down' });
  });
});

describe('unknown routes', () => {
  it('return the standard JSON error envelope, with the request ID', async () => {
    const { app } = testApp();

    const res = await app.request('/api/nope');

    expect(res.status).toBe(404);
    const body = ErrorEnvelope.parse(await res.json());
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Not found.',
        requestId: res.headers.get('X-Request-Id'),
      },
    });
  });
});

describe('request IDs', () => {
  it('are generated for every response', async () => {
    const { app } = testApp();

    const [a, b] = await Promise.all([app.request('/api/health'), app.request('/api/health')]);

    expect(a.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });

  it('are taken from the caller when well formed, and replaced when not', async () => {
    const { app } = testApp();

    const kept = await app.request('/api/health', { headers: { 'X-Request-Id': 'abc-123' } });
    const replaced = await app.request('/api/health', {
      headers: { 'X-Request-Id': 'bad id {"forged":true}' },
    });

    expect(kept.headers.get('X-Request-Id')).toBe('abc-123');
    expect(replaced.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers', () => {
  it('are on every response, including errors', async () => {
    const { app } = testApp();

    for (const path of ['/api/health', '/api/nope']) {
      const { headers } = await app.request(path);
      expect(headers.get('Content-Security-Policy')).toBe(
        "default-src 'self'; script-src 'self'; connect-src 'self' https://*.sentry.io; " +
          "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      );
      expect(headers.get('Strict-Transport-Security')).toBe('max-age=15552000; includeSubDomains');
      expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headers.get('X-Frame-Options')).toBe('DENY');
      expect(headers.get('Referrer-Policy')).toBe('no-referrer');
      // No CORS: the web app is same-origin, so no other site may read responses.
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });
});

describe('request logging', () => {
  it('writes one line per request with its ID, and never the query string', async () => {
    const { app, logs } = testApp();

    const res = await app.request('/api/nope?q=asha@example.com');

    expect(logs).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'request',
        requestId: res.headers.get('X-Request-Id'),
        method: 'GET',
        path: '/api/nope',
        status: 404,
        ms: expect.any(Number) as number,
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain('asha');
  });
});
