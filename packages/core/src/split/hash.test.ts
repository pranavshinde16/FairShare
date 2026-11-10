import { describe, expect, it } from 'vitest';
import { fnv1a32 } from './hash';

describe('fnv1a32', () => {
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('matches the published FNV-1a test vector for %j', (input, expected) => {
    expect(fnv1a32(input)).toBe(expected);
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('01JC5Z3Q8W5F0G9N1T2V3X4Y5Z');
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });
});
