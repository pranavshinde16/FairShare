import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const DATABASE_URL = 'postgres://fairshare:fairshare@localhost:5433/fairshare';

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadEnv({ DATABASE_URL, PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuses to start without DATABASE_URL and names the variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres connection string', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/x' })).toThrow(/postgres/);
  });

  it('accepts a separate migration connection, which must also be postgres', () => {
    const MIGRATION_DATABASE_URL = 'postgres://owner:pw@db.example.com/fairshare';
    expect(loadEnv({ DATABASE_URL, MIGRATION_DATABASE_URL }).MIGRATION_DATABASE_URL).toBe(
      MIGRATION_DATABASE_URL,
    );
    expect(() => loadEnv({ DATABASE_URL, MIGRATION_DATABASE_URL: 'mysql://x' })).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });

  it('treats an empty variable as unset', () => {
    const env = loadEnv({ DATABASE_URL, PORT: '', SENTRY_DSN: '', WEB_DIST_DIR: '' });
    expect(env.PORT).toBe(3000);
    expect(env).not.toHaveProperty('SENTRY_DSN');
    expect(env).not.toHaveProperty('WEB_DIST_DIR');
  });

  it('rejects an unknown log level and a malformed Sentry DSN', () => {
    expect(() => loadEnv({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
    expect(() => loadEnv({ DATABASE_URL, SENTRY_DSN: 'not a url' })).toThrow(/SENTRY_DSN/);
  });
});
