import { describe, expect, it } from 'vitest';
import { DEV_APP_URL, loadDatabaseEnv, loadEnv } from './env';

const DATABASE_URL = 'postgres://fairshare:fairshare@localhost:5433/fairshare';
const AUTH_SECRET = 'a-test-secret-that-is-at-least-32-chars';
const MAILPIT_URL = 'http://localhost:8025';
/** The smallest valid development configuration. */
const base = { DATABASE_URL, AUTH_SECRET, MAILPIT_URL };

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    expect(loadEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      APP_URL: DEV_APP_URL,
      CLIENT_IP_HEADERS: ['x-real-ip'],
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuses to start without DATABASE_URL and names the variable', () => {
    expect(() => loadEnv({ AUTH_SECRET, MAILPIT_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres connection string', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: 'mysql://localhost/x' })).toThrow(/postgres/);
  });

  it('accepts a separate migration connection, which must also be postgres', () => {
    const MIGRATION_DATABASE_URL = 'postgres://owner:pw@db.example.com/fairshare';
    expect(loadEnv({ ...base, MIGRATION_DATABASE_URL }).MIGRATION_DATABASE_URL).toBe(
      MIGRATION_DATABASE_URL,
    );
    expect(() => loadEnv({ ...base, MIGRATION_DATABASE_URL: 'mysql://x' })).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });

  it('treats an empty variable as unset', () => {
    const env = loadEnv({ ...base, PORT: '', SENTRY_DSN: '', WEB_DIST_DIR: '', APP_URL: '' });
    expect(env.PORT).toBe(3000);
    expect(env.APP_URL).toBe(DEV_APP_URL);
    expect(env).not.toHaveProperty('SENTRY_DSN');
    expect(env).not.toHaveProperty('WEB_DIST_DIR');
  });

  it('rejects an unknown log level and a malformed Sentry DSN', () => {
    expect(() => loadEnv({ ...base, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => loadEnv({ ...base, SENTRY_DSN: 'not a url' })).toThrow(/SENTRY_DSN/);
  });
});

describe('loadEnv: sign-in settings', () => {
  it('requires an auth secret of at least 32 characters', () => {
    expect(() => loadEnv({ DATABASE_URL, MAILPIT_URL })).toThrow(/AUTH_SECRET: is required/);
    expect(() => loadEnv({ ...base, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET: must be at/);
  });

  it('requires APP_URL outside development, as an origin with no path', () => {
    const production = { ...base, NODE_ENV: 'production' };
    expect(() => loadEnv(production)).toThrow(/APP_URL: is required/);
    expect(loadEnv({ ...production, APP_URL: 'https://fairshare.example/' }).APP_URL).toBe(
      'https://fairshare.example',
    );
    expect(() => loadEnv({ ...production, APP_URL: 'https://fairshare.example/app' })).toThrow(
      /APP_URL: must be an origin only/,
    );
    expect(() => loadEnv({ ...production, APP_URL: 'ftp://fairshare.example' })).toThrow(/APP_URL/);
  });

  it('needs both Google variables or neither', () => {
    expect(
      loadEnv({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }),
    ).toMatchObject({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_SECRET: 'secret' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('needs a way to send email, except in tests', () => {
    const { MAILPIT_URL: _, ...noEmail } = base;
    expect(() => loadEnv(noEmail)).toThrow(/RESEND_API_KEY: or MAILPIT_URL is required/);
    expect(() =>
      loadEnv({ ...noEmail, NODE_ENV: 'test', APP_URL: 'http://localhost:3000' }),
    ).not.toThrow();
  });

  it('needs a sender address with Resend', () => {
    const resend = { DATABASE_URL, AUTH_SECRET, RESEND_API_KEY: 're_test' };
    expect(() => loadEnv(resend)).toThrow(/EMAIL_FROM: is required with RESEND_API_KEY/);
    expect(loadEnv({ ...resend, EMAIL_FROM: 'FairShare <codes@fairshare.example>' })).toMatchObject(
      { EMAIL_FROM: 'FairShare <codes@fairshare.example>' },
    );
  });

  it('reads the client IP headers as a lower-case list', () => {
    expect(
      loadEnv({ ...base, CLIENT_IP_HEADERS: 'CF-Connecting-IP, x-real-ip,' }).CLIENT_IP_HEADERS,
    ).toEqual(['cf-connecting-ip', 'x-real-ip']);
  });
});

describe('loadDatabaseEnv', () => {
  it('needs only the database settings, so migrations run without the server’s secrets', () => {
    expect(loadDatabaseEnv({ DATABASE_URL, PORT: 'ignored' })).toEqual({ DATABASE_URL });
    expect(() => loadDatabaseEnv({})).toThrow(/DATABASE_URL/);
  });
});
