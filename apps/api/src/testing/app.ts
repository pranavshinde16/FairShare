// Test helpers: an app wired with fakes, and a logger whose output the test can read.

import { vi } from 'vitest';
import { createApp, type AppDeps } from '../app';
import type { AuthGateway, AuthSession } from '../modules/auth/auth';
import { createLogger } from '../observability/logger';

export type LogLine = { level: number; msg: string; [key: string]: unknown };

/** A real pino logger (redaction included) that collects parsed JSON lines instead of printing. */
export function captureLogs() {
  const lines: LogLine[] = [];
  const logger = createLogger({
    level: 'info',
    destination: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) },
  });
  return { logger, lines };
}

/** The origin the fake app treats as its own. */
export const TEST_ORIGIN = 'http://localhost:3000';

/** An auth gateway with a fixed session (none by default) and no Better Auth behind it. */
export function fakeAuth(session: AuthSession | null = null): AuthGateway {
  return {
    handler: () => Promise.resolve(Response.json({ fake: true }, { status: 404 })),
    getSession: () => Promise.resolve(session),
    signInOptions: { google: false },
  };
}

/** Stands in for a database-backed service: any call fails, naming what the test should use. */
function needsDatabase<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_, method) => () => {
      throw new Error(`${name}.${String(method)} needs a database; use integrationApp()`);
    },
  });
}

/** createApp with a healthy database, captured logs and a spy reporter, unless overridden. */
export function testApp(overrides: Partial<AppDeps> = {}) {
  const { logger, lines } = captureLogs();
  const deps: AppDeps = {
    pingDatabase: () => Promise.resolve('up'),
    logger,
    reportError: vi.fn(),
    web: null,
    appOrigin: TEST_ORIGIN,
    auth: fakeAuth(),
    domainUsers: needsDatabase('domainUsers'),
    users: needsDatabase('users'),
    currencies: needsDatabase('currencies'),
    ...overrides,
  };
  return { app: createApp(deps), deps, logs: lines };
}
