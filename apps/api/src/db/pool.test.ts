import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPool, describeDbError, pingDatabase } from './pool';

// Port 1 has nothing listening, so connections fail fast without a real database.
const UNREACHABLE = 'postgres://nobody:nothing@127.0.0.1:1/none';

describe('createPool', () => {
  it('survives an idle-connection error instead of crashing the process', async () => {
    const log = { warn: vi.fn() };
    const pool = createPool(UNREACHABLE, log);

    // EventEmitter throws on an 'error' event that has no listener.
    expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(log.warn).toHaveBeenCalledOnce();
    await pool.end();
  });
});

describe('pingDatabase', () => {
  it('reports "down" rather than throwing, and logs why without the connection string', async () => {
    const pool = createPool(UNREACHABLE, { warn: () => {} });
    const log = { warn: vi.fn() };

    await expect(pingDatabase(pool, log)).resolves.toBe('down');

    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      {
        dbError: {
          code: 'ECONNREFUSED',
          message: expect.stringContaining('ECONNREFUSED') as string,
        },
      },
      'database health check failed',
    );
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('nothing');
    await pool.end();
  });

  it('logs nothing when the database is up', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as pg.Pool;
    const log = { warn: vi.fn() };

    await expect(pingDatabase(pool, log)).resolves.toBe('up');
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('describeDbError', () => {
  it('keeps the Postgres error code and message', () => {
    const err = Object.assign(new Error('password authentication failed for user "api"'), {
      code: '28P01',
    });
    expect(describeDbError(err)).toEqual({
      code: '28P01',
      message: 'password authentication failed for user "api"',
    });
  });

  it('cuts any connection string out of the message, and drops the other fields', () => {
    const err = Object.assign(new TypeError('Invalid URL postgresql://api:s3cret@host/db?x=1'), {
      code: 'ERR_INVALID_URL',
      input: 'postgresql://api:s3cret@host/db?x=1',
    });

    const described = describeDbError(err);

    expect(described).toEqual({
      code: 'ERR_INVALID_URL',
      message: 'Invalid URL [connection string]',
    });
    expect(JSON.stringify(described)).not.toContain('s3cret');
  });

  it('uses the inner reasons of an AggregateError, whose own message is empty', () => {
    const err = Object.assign(
      new AggregateError(
        [
          new Error('connect ECONNREFUSED ::1:5432'),
          new Error('connect ECONNREFUSED 127.0.0.1:5432'),
        ],
        '',
      ),
      { code: 'ECONNREFUSED' },
    );
    expect(describeDbError(err)).toEqual({
      code: 'ECONNREFUSED',
      message: 'Error: connect ECONNREFUSED ::1:5432; Error: connect ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('handles a thrown non-error and an error without a code', () => {
    expect(describeDbError('boom')).toEqual({ message: 'non-error thrown' });
    expect(describeDbError(new Error('timeout exceeded when trying to connect'))).toEqual({
      message: 'timeout exceeded when trying to connect',
    });
  });
});
