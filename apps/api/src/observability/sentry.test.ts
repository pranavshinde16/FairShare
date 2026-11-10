import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_COLLECTION, flushSentry, initSentry } from './sentry';

afterEach(() => flushSentry(100));

const base = { NODE_ENV: 'production' as const };

describe('initSentry', () => {
  it('does nothing without a DSN', () => {
    const report = initSentry(base);

    expect(Sentry.isInitialized()).toBe(false);
    expect(() => report(new Error('x'), { requestId: 'r1' })).not.toThrow();
  });

  it('reports an error tagged with the request ID, with data collection switched off', async () => {
    const sent: string[] = [];
    const report = initSentry(
      {
        ...base,
        SENTRY_DSN: 'https://public@o1.ingest.sentry.io/1',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_RELEASE: 'abc123',
      },
      {
        // Stand-in for the network: keeps each envelope Sentry would send.
        transport: (options) =>
          Sentry.createTransport(options, (request) => {
            sent.push(String(request.body));
            return Promise.resolve({ statusCode: 200 });
          }),
      },
    );

    report(new Error('ledger out of balance'), { requestId: 'req-42' });
    await Sentry.flush(1_000);

    const event = sent.find((body) => body.includes('ledger out of balance'));
    expect(event).toBeDefined();
    expect(event).toContain('"requestId":"req-42"');
    expect(event).toContain('"environment":"staging"');
    expect(event).toContain('"release":"abc123"');
    expect(Sentry.getClient()?.getOptions().dataCollection).toEqual(DATA_COLLECTION);
  });
});
