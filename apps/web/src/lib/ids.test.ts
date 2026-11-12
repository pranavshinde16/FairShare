import { Uuid } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids';

describe('uuidv7', () => {
  it('is a version 7 UUID the contracts accept, starting with the time', () => {
    const now = Date.UTC(2026, 10, 12);
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Uuid.safeParse(id).success).toBe(true);
    expect(id.replace(/-/g, '').slice(0, 12)).toBe(now.toString(16).padStart(12, '0'));
  });

  it('sorts by time and differs within a millisecond', () => {
    expect(uuidv7(1) < uuidv7(2)).toBe(true);
    expect(new Set(Array.from({ length: 500 }, () => uuidv7(0))).size).toBe(500);
  });
});
