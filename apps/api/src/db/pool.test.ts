import { describe, expect, it, vi } from 'vitest';
import { createPool, pingDatabase } from './pool';

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
  it('reports "down" rather than throwing when the database is unreachable', async () => {
    const pool = createPool(UNREACHABLE, { warn: () => {} });
    await expect(pingDatabase(pool)).resolves.toBe('down');
    await pool.end();
  });
});
