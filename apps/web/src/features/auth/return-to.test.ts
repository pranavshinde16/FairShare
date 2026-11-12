import { describe, expect, it } from 'vitest';
import { HOME, safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps a path on this site, with its query and hash', () => {
    expect(safeReturnTo('/settings')).toBe('/settings');
    expect(safeReturnTo('/groups/123?tab=balances#top')).toBe('/groups/123?tab=balances#top');
    expect(safeReturnTo('/invite/abc')).toBe('/invite/abc');
  });

  it('sends anything that could leave the site to Home', () => {
    for (const value of [
      'https://evil.example/',
      '//evil.example/path',
      '/\\evil.example',
      'javascript:alert(1)',
      'settings',
      '',
      ' /settings',
    ]) {
      expect(safeReturnTo(value)).toBe(HOME);
    }
  });

  it('sends the sign-in pages themselves to Home, so sign-in can’t loop', () => {
    expect(safeReturnTo('/sign-in')).toBe(HOME);
    expect(safeReturnTo('/sign-in/verify?x=1')).toBe(HOME);
    expect(safeReturnTo('/sign-in-help')).toBe('/sign-in-help');
  });

  it('ignores non-strings and overly long values', () => {
    expect(safeReturnTo(undefined)).toBe(HOME);
    expect(safeReturnTo(42)).toBe(HOME);
    expect(safeReturnTo(`/${'a'.repeat(2048)}`)).toBe(HOME);
  });
});
