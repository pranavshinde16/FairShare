import { Uuid } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids';

describe('uuidv7', () => {
  it('is a version 7, RFC-variant UUID the contracts accept', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Uuid.safeParse(id).success).toBe(true);
  });

  it('starts with the timestamp, so later IDs sort later', () => {
    const now = Date.UTC(2026, 10, 12, 10, 0, 0);
    expect(uuidv7(now).replace(/-/g, '').slice(0, 12)).toBe(now.toString(16).padStart(12, '0'));
    expect(uuidv7(now) < uuidv7(now + 1)).toBe(true);
  });

  it('differs between calls in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)));
    expect(ids.size).toBe(1000);
  });
});
