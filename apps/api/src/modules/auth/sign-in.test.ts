// The real email-code sign-in, through Better Auth, against a fresh database.

import { Profile } from '@fairshare/contracts';
import { auth_session, auth_user, users } from '@fairshare/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../lib/rate-limit';
import { integrationApp, sessionCookie, type IntegrationApp } from '../../testing/integration';
import { SEED_ACCOUNTS, seedDemo } from '@fairshare/db/testing';

let n = 0;
/** A new address per test, so tests don't share codes or limits. */
const nextEmail = (name = 'asha.kapoor') => `${name}+${++n}@example.com`;

const ctx: IntegrationApp = await integrationApp();
afterAll(() => ctx.drop());
beforeEach(() => {
  ctx.outbox.messages.length = 0;
});

describe('sending a code', () => {
  it('emails one 6-digit code that expires in 5 minutes', async () => {
    const email = nextEmail();

    const res = await ctx.sendCode(email);

    expect(res.status).toBe(200);
    expect(ctx.outbox.messages).toHaveLength(1);
    const [message] = ctx.outbox.messages;
    const code = ctx.latestCode(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(message).toMatchObject({ to: email, subject: `${code} is your FairShare sign-in code` });
    expect(message!.text).toContain('expires in 5 minutes');
    expect(message!.html).toContain(code);
  });

  it('stores only a hash of the code', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);

    const { rows } = await ctx.pool.query<{ value: string }>(
      'SELECT value FROM auth_verification WHERE identifier LIKE $1',
      [`%${email}%`],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain(ctx.latestCode(email));
  });

  it('replaces the previous code when a new one is requested', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);
    const first = ctx.latestCode(email);
    await ctx.sendCode(email);
    const second = ctx.latestCode(email);

    if (first !== second) {
      expect((await ctx.submitCode(email, first)).status).toBe(400);
    }
    expect((await ctx.submitCode(email, second)).status).toBe(200);
  });
});

describe('the per-email code limit', () => {
  it('allows 3 codes per address in the window, then answers 429 with Retry-After', async () => {
    const limited = await integrationApp({
      codeLimiter: createRateLimiter({ max: 3, windowMs: 10 * 60_000 }),
    });
    try {
      const email = nextEmail();
      for (let i = 0; i < 3; i++) expect((await limited.sendCode(email)).status).toBe(200);

      const res = await limited.sendCode(email.toUpperCase());

      expect(res.status).toBe(429);
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(await res.json()).toMatchObject({ code: 'TOO_MANY_CODES' });
      expect(limited.outbox.messages).toHaveLength(3);
      // Another address is unaffected.
      expect((await limited.sendCode(nextEmail())).status).toBe(200);
    } finally {
      await limited.drop();
    }
  });
});

describe('signing in with the code', () => {
  it('sets a 30-day, HttpOnly, SameSite=Lax session cookie and opens the API', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);

    const res = await ctx.submitCode(email, ctx.latestCode(email));

    expect(res.status).toBe(200);
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('fairshare.session_token='))!;
    expect(cookie).toMatch(/; Max-Age=2592000(;|$)/);
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(cookie).not.toMatch(/Domain=/);

    const me = await ctx.request('/api/v1/me', { cookie: sessionCookie(res) });
    expect(me.status).toBe(200);
  });

  it('creates the domain user on first sign-in: name from the email, currency from the browser', async () => {
    const email = nextEmail('bilal_khan');

    const { cookie } = await ctx.signIn(email, { 'Accept-Language': 'en-GB,en;q=0.9' });
    const me = Profile.parse(await (await ctx.request('/api/v1/me', { cookie })).json());

    expect(me).toMatchObject({
      name: 'Bilal Khan',
      email,
      avatarUrl: null,
      defaultCurrency: 'GBP',
      upiVpa: null,
    });
    expect(me.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7
  });

  it('defaults the currency to INR when the browser names no region', async () => {
    const { cookie } = await ctx.signIn(nextEmail(), { 'Accept-Language': 'en' });
    const me = Profile.parse(await (await ctx.request('/api/v1/me', { cookie })).json());
    expect(me.defaultCurrency).toBe('INR');
  });

  it('keeps one domain user per person across sign-ins', async () => {
    const email = nextEmail();
    const first = await ctx.signIn(email);
    const second = await ctx.signIn(email);

    const a = Profile.parse(await (await ctx.request('/api/v1/me', first)).json());
    const b = Profile.parse(await (await ctx.request('/api/v1/me', second)).json());

    expect(b.id).toBe(a.id);
    const rows = await ctx.db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.authUserId).not.toBeNull();
  });

  it('treats the address case-insensitively', async () => {
    const email = nextEmail();
    const { cookie } = await ctx.signIn(email);
    const upper = await ctx.signIn(email.toUpperCase());

    const a = Profile.parse(await (await ctx.request('/api/v1/me', { cookie })).json());
    const b = Profile.parse(await (await ctx.request('/api/v1/me', upper)).json());
    expect(b.id).toBe(a.id);
    expect(b.email).toBe(email);
  });

  it('rejects a wrong code, then locks the code after 3 wrong tries', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);
    const code = ctx.latestCode(email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 3; i++) {
      const res = await ctx.submitCode(email, wrong);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' });
    }
    const locked = await ctx.submitCode(email, code);

    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('accepts a code once only', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);
    const code = ctx.latestCode(email);

    expect((await ctx.submitCode(email, code)).status).toBe(200);
    expect((await ctx.submitCode(email, code)).status).toBe(400);
  });

  it('rejects an expired code', async () => {
    const email = nextEmail();
    await ctx.sendCode(email);
    await ctx.pool.query(
      `UPDATE auth_verification SET expires_at = now() - interval '1 second' WHERE identifier LIKE $1`,
      [`%${email}%`],
    );

    const res = await ctx.submitCode(email, ctx.latestCode(email));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('never writes the code or the address to the logs', async () => {
    const email = nextEmail('privacy.check');
    await ctx.signIn(email);
    const code = ctx.latestCode(email);

    const logged = JSON.stringify(ctx.logs);
    expect(logged).not.toContain(code);
    expect(logged).not.toContain('privacy.check');
  });
});

describe('sessions', () => {
  it('answer 401 on protected routes without a valid cookie', async () => {
    for (const cookie of [undefined, 'fairshare.session_token=forged.value']) {
      const res = await ctx.request('/api/v1/me', { cookie });
      expect(res.status).toBe(401);
    }
  });

  it('end at sign-out: the session row is deleted and the cookie stops working', async () => {
    const email = nextEmail();
    const { cookie } = await ctx.signIn(email);

    const out = await ctx.request('/api/auth/sign-out', { method: 'POST', cookie, body: {} });

    expect(out.status).toBe(200);
    const [authUser] = await ctx.db.select().from(auth_user).where(eq(auth_user.email, email));
    const sessions = await ctx.db
      .select()
      .from(auth_session)
      .where(eq(auth_session.userId, authUser!.id));
    expect(sessions).toHaveLength(0);
    expect((await ctx.request('/api/v1/me', { cookie })).status).toBe(401);
  });

  it('can’t be ended from another site (Better Auth’s origin check)', async () => {
    const { cookie } = await ctx.signIn(nextEmail());

    const res = await ctx.request('/api/auth/sign-out', {
      method: 'POST',
      cookie,
      body: {},
      headers: { Origin: 'https://evil.example' },
    });

    expect(res.status).toBe(403);
    expect((await ctx.request('/api/v1/me', { cookie })).status).toBe(200);
  });

  it('are reported by Better Auth’s get-session', async () => {
    const { cookie } = await ctx.signIn(nextEmail());

    const res = await ctx.request('/api/auth/get-session', { cookie });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { emailVerified: true } });
    expect(await (await ctx.request('/api/auth/get-session')).json()).toBeNull();
  });
});

describe('over https', () => {
  it('uses the __Secure- cookie prefix and the Secure flag', async () => {
    const secure = await integrationApp({ appUrl: 'https://fairshare.example' });
    try {
      const email = nextEmail();
      await secure.sendCode(email);

      const res = await secure.submitCode(email, secure.latestCode(email));

      const cookie = res.headers.getSetCookie().find((c) => c.includes('session_token='))!;
      expect(cookie).toMatch(/^__Secure-fairshare\.session_token=/);
      expect(cookie).toMatch(/; Secure(;|$)/);
      expect((await secure.request('/api/v1/me', { cookie: sessionCookie(res) })).status).toBe(200);
    } finally {
      await secure.drop();
    }
  });
});

describe('Google sign-in', () => {
  it('is offered only when configured', async () => {
    expect(await (await ctx.request('/api/v1/sign-in-options')).json()).toEqual({ google: false });

    const google = await integrationApp({ google: true });
    try {
      expect(await (await google.request('/api/v1/sign-in-options')).json()).toEqual({
        google: true,
      });
    } finally {
      await google.drop();
    }
  });

  it('redirects to Google with our callback URL, and refuses a callback on another site', async () => {
    const google = await integrationApp({ google: true, appUrl: 'https://fairshare.example' });
    try {
      const start = await google.request('/api/auth/sign-in/social', {
        method: 'POST',
        body: { provider: 'google', callbackURL: '/settings' },
      });
      expect(start.status).toBe(200);
      const { url } = (await start.json()) as { url: string };
      const authorize = new URL(url);
      expect(authorize.origin).toBe('https://accounts.google.com');
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        'https://fairshare.example/api/auth/callback/google',
      );
      expect(authorize.searchParams.get('prompt')).toBe('select_account');

      const evil = await google.request('/api/auth/sign-in/social', {
        method: 'POST',
        body: { provider: 'google', callbackURL: 'https://evil.example/' },
      });
      expect(evil.status).toBe(403);
    } finally {
      await google.drop();
    }
  });
});

describe('the demo seed', () => {
  it('lets the seeded accounts sign in by email code, as their seeded users', async () => {
    const seeded = await integrationApp();
    try {
      await seedDemo(seeded.db);
      for (const account of SEED_ACCOUNTS) {
        const { cookie } = await seeded.signIn(account.email);
        const me = Profile.parse(await (await seeded.request('/api/v1/me', { cookie })).json());
        expect(me).toMatchObject({ id: account.userId, name: account.name, email: account.email });
      }
    } finally {
      await seeded.drop();
    }
  });
});
