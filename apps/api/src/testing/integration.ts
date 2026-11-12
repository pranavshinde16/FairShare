// The real app (Better Auth, services, repos) on a fresh database cloned from the migrated
// template, with emails collected in an outbox instead of sent.

import { createTestDatabase } from '@fairshare/db/testing';
import { expect, vi } from 'vitest';
import { composeApp } from '../compose';
import { loadEnv } from '../config/env';
import { createOutbox } from '../lib/email/sender';
import type { RateLimiter } from '../lib/rate-limit';
import { captureLogs, TEST_ORIGIN } from './app';

export type IntegrationOptions = {
  /** Configure Google sign-in (with fake credentials; nothing calls Google). */
  google?: boolean;
  codeLimiter?: RateLimiter;
  invitePreviewLimiter?: RateLimiter;
  clock?: () => Date;
  /** The app's origin. Over https, cookies get the __Secure- prefix and the Secure flag. */
  appUrl?: string;
};

export type RequestInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
};

export async function integrationApp(options: IntegrationOptions = {}) {
  const database = await createTestDatabase();
  const outbox = createOutbox();
  const { logger, lines } = captureLogs();
  const reportError = vi.fn();
  const appUrl = options.appUrl ?? TEST_ORIGIN;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    APP_URL: appUrl,
    AUTH_SECRET: 'integration-test-secret-0123456789abcdef',
    ...(options.google && { GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret' }),
  });
  const app = composeApp({
    env,
    db: database.db,
    pingDatabase: () => Promise.resolve('up'),
    logger,
    reportError,
    emailSender: outbox.sender,
    web: null,
    codeLimiter: options.codeLimiter,
    invitePreviewLimiter: options.invitePreviewLimiter,
    clock: options.clock,
  });

  /** A request as the web app sends it: same origin, JSON body. */
  function request(path: string, init: RequestInit = {}) {
    const headers: Record<string, string> = { Origin: appUrl, ...init.headers };
    if (init.cookie) headers.Cookie = init.cookie;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    return app.request(new URL(path, appUrl), {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  /** The newest sign-in code emailed to `email`. */
  function latestCode(email: string): string {
    // Better Auth sends to the lower-cased address.
    const message = outbox.messages.findLast((m) => m.to === email.toLowerCase());
    const code = message && /\b(\d{6})\b/.exec(message.text)?.[1];
    if (!code) throw new Error(`No sign-in code was sent to ${email}`);
    return code;
  }

  async function sendCode(email: string, headers?: Record<string, string>) {
    return request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: { email, type: 'sign-in' },
      headers,
    });
  }

  async function submitCode(email: string, otp: string, headers?: Record<string, string>) {
    return request('/api/auth/sign-in/email-otp', {
      method: 'POST',
      body: { email, otp },
      headers,
    });
  }

  /** Signs in through the real email-code flow and returns the session cookie to send. */
  async function signIn(email: string, headers?: Record<string, string>) {
    expect((await sendCode(email, headers)).status).toBe(200);
    const res = await submitCode(email, latestCode(email), headers);
    expect(res.status).toBe(200);
    return { cookie: sessionCookie(res) };
  }

  /** Signs a new person in and returns their session cookie and domain user ID. */
  async function person(email: string) {
    const { cookie } = await signIn(email);
    const me = (await (await request('/api/v1/me', { cookie })).json()) as { id: string };
    return { cookie, id: me.id, email };
  }

  /**
   * Sends a request as `who` and returns the status and the JSON body (null for 204). Tests parse
   * the body with its contract schema, which also checks the response's shape.
   */
  async function call(
    who: { cookie: string } | null,
    method: NonNullable<RequestInit['method']>,
    path: string,
    body?: unknown,
  ) {
    const res = await request(path, { method, cookie: who?.cookie, body });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
  }

  return {
    app,
    db: database.db,
    pool: database.pool,
    outbox,
    logs: lines,
    reportError,
    request,
    latestCode,
    sendCode,
    submitCode,
    signIn,
    person,
    call,
    drop: database.drop,
  };
}

export type IntegrationApp = Awaited<ReturnType<typeof integrationApp>>;

/** The Cookie header that carries the session a response set. */
export function sessionCookie(res: Response): string {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => /^(__Secure-)?fairshare\.session_token=/.test(c));
  if (!cookie) throw new Error('The response set no session cookie');
  return cookie.split(';')[0]!;
}
