import { describe, expect, it } from 'vitest';
import { captureLogs } from '../testing/app';
import { REDACTED_KEYS } from './logger';

describe('the logger', () => {
  it('redacts personal data and secrets at any of the first three levels', () => {
    const { logger, lines } = captureLogs();

    logger.info({
      email: 'asha@example.com',
      user: { email: 'bilal@example.com', name: 'Bilal' },
      req: { headers: { cookie: 'session=abc', authorization: 'Bearer xyz' } },
      body: { otp: '123456', token: 'invite-token' },
    });

    expect(lines[0]).toMatchObject({
      email: '[redacted]',
      user: { email: '[redacted]', name: 'Bilal' },
      req: { headers: { cookie: '[redacted]', authorization: '[redacted]' } },
      body: { otp: '[redacted]', token: '[redacted]' },
    });
    const text = JSON.stringify(lines);
    for (const secret of ['asha@', 'bilal@', 'session=abc', 'xyz', '123456', 'invite-token']) {
      expect(text).not.toContain(secret);
    }
  });

  it('covers the keys named in the security plan', () => {
    expect(REDACTED_KEYS).toEqual(
      expect.arrayContaining(['email', 'otp', 'cookie', 'authorization']),
    );
  });

  it('serializes errors with their message and stack', () => {
    const { logger, lines } = captureLogs();

    logger.error({ err: new Error('boom') }, 'failed');

    expect(lines[0]).toMatchObject({
      level: 50,
      msg: 'failed',
      err: { type: 'Error', message: 'boom', stack: expect.stringContaining('boom') as string },
    });
  });
});
