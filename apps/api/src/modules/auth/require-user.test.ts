import { ErrorEnvelope, Profile } from '@fairshare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuth, testApp } from '../../testing/app';
import type { UsersService } from '../users/service';
import type { DomainUserResolver } from './domain-users';

const USER_ID = '01900000-0000-7000-8000-00000000000a';
const authUser = { id: 'auth-1', name: '', email: 'asha@example.com', image: null };
const profile: Profile = {
  id: USER_ID,
  name: 'Asha',
  email: 'asha@example.com',
  avatarUrl: null,
  defaultCurrency: 'INR',
  upiVpa: null,
  createdAt: '2026-11-01T08:00:00.000Z',
};

function signedInApp(setCookies: string[] = []) {
  const idFor = vi.fn<DomainUserResolver['idFor']>(() => Promise.resolve(USER_ID));
  const getProfile = vi.fn<UsersService['getProfile']>(() => Promise.resolve(profile));
  const { app, logs } = testApp({
    auth: fakeAuth({ authUser, setCookies }),
    domainUsers: { idFor },
    users: { getProfile } as unknown as UsersService,
  });
  return { app, logs, idFor, getProfile };
}

describe('requireUser', () => {
  it('answers 401 UNAUTHENTICATED without a session, with the request ID', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/me');

    expect(res.status).toBe(401);
    expect(ErrorEnvelope.parse(await res.json()).error).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'Sign in to continue.',
      requestId: res.headers.get('X-Request-Id'),
    });
  });

  it('resolves the domain user (passing the browser language) and hands its ID to the route', async () => {
    const { app, idFor, getProfile } = signedInApp();

    const res = await app.request('/api/v1/me', { headers: { 'Accept-Language': 'en-IN' } });

    expect(res.status).toBe(200);
    expect(Profile.parse(await res.json())).toEqual(profile);
    expect(idFor).toHaveBeenCalledWith(authUser, 'en-IN');
    expect(getProfile).toHaveBeenCalledWith(USER_ID);
  });

  it('passes on a refreshed session cookie', async () => {
    const cookie = 'fairshare.session_token=new; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax';
    const { app } = signedInApp([cookie]);

    const res = await app.request('/api/v1/me');

    expect(res.headers.getSetCookie()).toEqual([cookie]);
  });

  it('binds the user ID to the request’s log lines', async () => {
    const { app, logs } = signedInApp();

    await app.request('/api/v1/me');

    expect(logs.at(-1)).toMatchObject({ msg: 'request', userId: USER_ID });
  });

  it('leaves the public sign-in options alone', async () => {
    const { app } = testApp();

    const res = await app.request('/api/v1/sign-in-options');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ google: false });
  });
});
