// GET/PATCH /me, the currencies list and account anonymization, against a fresh database.

import { CurrencyList, ErrorEnvelope, Profile } from '@fairshare/contracts';
import { auth_account, auth_session, auth_user, users } from '@fairshare/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { integrationApp } from '../../testing/integration';
import { createUsersService } from './service';

const ctx = await integrationApp();
afterAll(() => ctx.drop());

let n = 0;
async function signedIn() {
  const email = `asha+${++n}@example.com`;
  const { cookie } = await ctx.signIn(email);
  const me = Profile.parse(await (await ctx.request('/api/v1/me', { cookie })).json());
  return { cookie, me, email };
}

const patchMe = (cookie: string, body: unknown) =>
  ctx.request('/api/v1/me', { method: 'PATCH', cookie, body });

describe('PATCH /me', () => {
  it('updates the name, default currency and UPI ID, and returns the profile', async () => {
    const { cookie, me } = await signedIn();

    const res = await patchMe(cookie, {
      name: '  Asha K  ',
      defaultCurrency: 'USD',
      upiVpa: 'asha@okaxis',
    });

    expect(res.status).toBe(200);
    const updated = Profile.parse(await res.json());
    expect(updated).toEqual({
      ...me,
      name: 'Asha K',
      defaultCurrency: 'USD',
      upiVpa: 'asha@okaxis',
    });
    expect(Profile.parse(await (await ctx.request('/api/v1/me', { cookie })).json())).toEqual(
      updated,
    );
  });

  it('changes only the fields sent; upiVpa: null removes the UPI ID', async () => {
    const { cookie } = await signedIn();
    await patchMe(cookie, { upiVpa: 'asha@okaxis', defaultCurrency: 'EUR' });

    const res = await patchMe(cookie, { upiVpa: null });

    expect(Profile.parse(await res.json())).toMatchObject({ upiVpa: null, defaultCurrency: 'EUR' });
  });

  it('returns the profile unchanged for an empty body', async () => {
    // Found by the authorization matrix: an empty update used to fail with a 500.
    const { cookie, me } = await signedIn();
    const res = await patchMe(cookie, {});
    expect(res.status).toBe(200);
    expect(Profile.parse(await res.json())).toEqual(me);
  });

  it('rejects a well-formed but unsupported currency, pointing at the field', async () => {
    const { cookie } = await signedIn();

    const res = await patchMe(cookie, { defaultCurrency: 'XXX' });

    expect(res.status).toBe(400);
    const { error } = ErrorEnvelope.parse(await res.json());
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual({
      issues: [{ path: ['defaultCurrency'], message: 'Unsupported currency', code: 'custom' }],
    });
  });

  it('rejects invalid values and unknown fields with VALIDATION_FAILED', async () => {
    const { cookie } = await signedIn();

    for (const body of [
      { name: '' },
      { name: 'x'.repeat(61) },
      { defaultCurrency: 'inr' },
      { upiVpa: 'not-a-upi-id' },
      { email: 'other@example.com' },
    ]) {
      const res = await patchMe(cookie, body);
      expect(res.status).toBe(400);
      expect(ErrorEnvelope.parse(await res.json()).error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('needs a session, and the app’s Origin', async () => {
    const { cookie } = await signedIn();

    expect((await ctx.request('/api/v1/me', { method: 'PATCH', body: {} })).status).toBe(401);
    const crossSite = await ctx.request('/api/v1/me', {
      method: 'PATCH',
      cookie,
      body: { name: 'Hacked' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(crossSite.status).toBe(403);
  });
});

describe('GET /currencies', () => {
  it('lists every seeded currency, sorted by code', async () => {
    const { cookie } = await signedIn();

    const res = await ctx.request('/api/v1/currencies', { cookie });

    expect(res.status).toBe(200);
    const { items } = CurrencyList.parse(await res.json());
    expect(items).toHaveLength(34);
    expect(items.map((c) => c.code)).toEqual(items.map((c) => c.code).sort());
    expect(items).toContainEqual({ code: 'INR', minorUnits: 2, symbol: '₹' });
    expect(items).toContainEqual({ code: 'KWD', minorUnits: 3, symbol: 'KD' });
  });

  it('needs a session', async () => {
    expect((await ctx.request('/api/v1/currencies')).status).toBe(401);
  });
});

describe('ensureDomainUser', () => {
  const service = createUsersService(ctx.db);

  async function authUser(values: { email: string; name?: string; image?: string | null }) {
    const id = `auth-${++n}`;
    await ctx.db.insert(auth_user).values({ id, name: values.name ?? '', ...values });
    return { id, name: values.name ?? '', email: values.email, image: values.image ?? null };
  }

  it('creates one domain user even when called many times at once', async () => {
    const user = await authUser({ email: `race+${n}@example.com` });
    // Open the pool's connections first. Otherwise the first call finishes before the others get
    // a connection, they find its row, and the race this test is about never happens.
    await Promise.all(Array.from({ length: 5 }, () => ctx.pool.query('SELECT pg_sleep(0.05)')));

    const ids = await Promise.all(Array.from({ length: 5 }, () => service.ensureDomainUser(user)));

    expect(new Set(ids).size).toBe(1);
    const rows = await ctx.db.select().from(users).where(eq(users.authUserId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('takes the Google name and an https picture', async () => {
    const user = await authUser({
      email: `g+${n}@example.com`,
      name: 'Asha Kapoor',
      image: 'https://lh3.googleusercontent.com/a/photo',
    });

    const id = await service.ensureDomainUser(user, 'en-IN');

    expect(await service.getProfile(id)).toMatchObject({
      name: 'Asha Kapoor',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
      defaultCurrency: 'INR',
    });
  });

  it('drops a picture that isn’t https', async () => {
    for (const image of ['http://example.com/a.png', 'javascript:alert(1)', 'not a url']) {
      const user = await authUser({ email: `img+${n}@example.com`, image });
      const id = await service.ensureDomainUser(user);
      expect((await service.getProfile(id)).avatarUrl).toBeNull();
    }
  });
});

describe('deleteAccount (the service)', () => {
  it('clears the person’s details, keeps the row, and removes the auth user and its sessions', async () => {
    const { cookie, me } = await signedIn();
    await patchMe(cookie, { upiVpa: 'asha@okaxis' });
    const [before] = await ctx.db.select().from(users).where(eq(users.id, me.id));
    const authUserId = before!.authUserId!;

    await createUsersService(ctx.db).deleteAccount(me.id);

    const [after] = await ctx.db.select().from(users).where(eq(users.id, me.id));
    expect(after).toMatchObject({
      name: 'Deleted user',
      email: null,
      avatarUrl: null,
      upiVpa: null,
      authUserId: null,
    });
    expect(after!.deletedAt).toBeInstanceOf(Date);
    for (const table of [auth_session, auth_account] as const) {
      expect(await ctx.db.select().from(table).where(eq(table.userId, authUserId))).toHaveLength(0);
    }
    expect(await ctx.db.select().from(auth_user).where(eq(auth_user.id, authUserId))).toHaveLength(
      0,
    );
    expect((await ctx.request('/api/v1/me', { cookie })).status).toBe(401);
  });

  it('is safe to run twice and keeps the first deletion time', async () => {
    const { me } = await signedIn();
    const service = createUsersService(ctx.db);
    await service.deleteAccount(me.id);
    const [first] = await ctx.db.select().from(users).where(eq(users.id, me.id));

    await service.deleteAccount(me.id);

    const [second] = await ctx.db.select().from(users).where(eq(users.id, me.id));
    expect(second!.deletedAt).toEqual(first!.deletedAt);
  });
});
