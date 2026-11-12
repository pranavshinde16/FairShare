import { Uuid } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { createUuidV7, uuidv7 } from './ids';

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timeOf = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16);

describe('createUuidV7', () => {
  it('makes version 7, RFC-variant UUIDs the contracts accept', () => {
    const id = uuidv7();
    expect(id).toMatch(SHAPE);
    expect(Uuid.safeParse(id).success).toBe(true);
  });

  it('starts each ID with the clock’s milliseconds', () => {
    const now = Date.UTC(2026, 10, 12, 10, 0, 0);
    expect(timeOf(createUuidV7(() => now)())).toBe(now);
  });

  it('only ever increases, even thousands of times in one millisecond', () => {
    const next = createUuidV7(() => 1_000);
    const ids = Array.from({ length: 10_000 }, next);
    expect(ids.every((id) => SHAPE.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    // 4096 counter values fit in a millisecond; past that the time moves on.
    expect(timeOf(ids.at(-1)!)).toBeGreaterThan(1_000);
  });

  it('keeps increasing when the clock steps back', () => {
    let now = 5_000;
    const next = createUuidV7(() => now);
    const first = next();
    now = 4_000;
    const second = next();
    expect(second > first).toBe(true);
    expect(timeOf(second)).toBe(5_000);
  });

  it('follows the clock forward', () => {
    let now = 1_000;
    const next = createUuidV7(() => now);
    next();
    now = 2_000;
    expect(timeOf(next())).toBe(2_000);
  });
});
