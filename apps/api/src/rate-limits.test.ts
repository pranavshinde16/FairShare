// Rate limits on every route group (Blueprint 9.1), against the real app: the signed-in API per
// user, public routes per IP, and Better Auth's own per-IP sign-in limits. The budgets here are
// small so the tests are quick; the production numbers are checked below.

import { ErrorEnvelope } from '@fairshare/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  API_REQUESTS_PER_USER,
  CODES_PER_EMAIL,
  INVITE_PREVIEWS_PER_IP,
  PUBLIC_REQUESTS_PER_IP,
} from './compose';
import { createRateLimiter } from './lib/rate-limit';
import { integrationApp } from './testing/integration';

const ctx = await integrationApp({
  userLimiter: createRateLimiter({ max: 3, windowMs: 60_000 }),
  publicLimiter: createRateLimiter({ max: 2, windowMs: 60_000 }),
  authRateLimit: true,
});
afterAll(() => ctx.drop());

const ip = (n: number) => ({ 'X-Real-IP': `198.51.100.${n}` });

async function expectLimited(res: Response) {
  expect(res.status).toBe(429);
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(ErrorEnvelope.parse(await res.json()).error.code).toBe('RATE_LIMITED');
}

describe('the signed-in API', () => {
  it('allows each person their own budget, then answers 429 with Retry-After', async () => {
    // Signing in goes through Better Auth, which the API limit doesn't count.
    const asha = await ctx.signIn('asha@example.com', ip(1));
    const bilal = await ctx.signIn('bilal@example.com', ip(2));

    for (let i = 0; i < 3; i++) {
      expect((await ctx.request('/api/v1/me', { cookie: asha.cookie })).status).toBe(200);
    }
    await expectLimited(await ctx.request('/api/v1/groups', { cookie: asha.cookie }));
    // Bilal, on the same server, is unaffected.
    expect((await ctx.request('/api/v1/me', { cookie: bilal.cookie })).status).toBe(200);
  });
});

describe('public routes', () => {
  it('limit the health check and sign-in options together, per client IP', async () => {
    expect((await ctx.request('/api/health', { headers: ip(10) })).status).toBe(200);
    expect((await ctx.request('/api/v1/sign-in-options', { headers: ip(10) })).status).toBe(200);
    await expectLimited(await ctx.request('/api/health', { headers: ip(10) }));
    expect((await ctx.request('/api/health', { headers: ip(11) })).status).toBe(200);
  });
});

describe('sign-in (Better Auth)', () => {
  it('limits sign-in codes per IP, whatever the address', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await ctx.sendCode(`person${i}@example.com`, ip(20))).status).toBe(200);
    }
    const res = await ctx.sendCode('person9@example.com', ip(20));
    expect(res.status).toBe(429);
    // Another IP still gets through.
    expect((await ctx.sendCode('person9@example.com', ip(21))).status).toBe(200);
  });
});

describe('the production budgets', () => {
  it('are the plan’s', () => {
    expect(API_REQUESTS_PER_USER).toEqual({ max: 120, windowMs: 60_000 });
    expect(INVITE_PREVIEWS_PER_IP).toEqual({ max: 30, windowMs: 60_000 });
    expect(PUBLIC_REQUESTS_PER_IP).toEqual({ max: 60, windowMs: 60_000 });
    expect(CODES_PER_EMAIL).toEqual({ max: 3, windowMs: 600_000 });
  });
});
