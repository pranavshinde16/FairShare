import { describe, expect, it } from 'vitest';
import { initials } from './avatar';

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Asha Kapoor')).toBe('AK');
    expect(initials('Asha Rani Kapoor')).toBe('AK');
    expect(initials('  bilal  ')).toBe('B');
  });

  it('keeps a character made of two UTF-16 units whole', () => {
    expect(initials('😀 Smile')).toBe('😀S');
  });
});
