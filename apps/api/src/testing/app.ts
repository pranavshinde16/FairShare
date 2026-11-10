// Test helpers: an app wired with fakes, and a logger whose output the test can read.

import { vi } from 'vitest';
import { createApp, type AppDeps } from '../app';
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

/** createApp with a healthy database, captured logs and a spy reporter, unless overridden. */
export function testApp(overrides: Partial<AppDeps> = {}) {
  const { logger, lines } = captureLogs();
  const deps: AppDeps = {
    pingDatabase: () => Promise.resolve('up'),
    logger,
    reportError: vi.fn(),
    web: null,
    ...overrides,
  };
  return { app: createApp(deps), deps, logs: lines };
}
