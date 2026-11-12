import { describe, expect, it } from 'vitest';
import { tokenFromLink } from './join-with-link';

const TOKEN = 'BPx_xVBvsLcdBwVJHK_I9a1jXsskIolQXW2hmkHNMpw';

describe('tokenFromLink', () => {
  it('finds the token in a full link, a pasted path, or on its own', () => {
    expect(tokenFromLink(`https://fairshare.example/invite/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromLink(`  /invite/${TOKEN}?utm=x `)).toBe(TOKEN);
    expect(tokenFromLink(TOKEN)).toBe(TOKEN);
  });

  it('rejects anything else', () => {
    expect(tokenFromLink('https://fairshare.example/groups/123')).toBeNull();
    expect(tokenFromLink('/invite/short')).toBeNull();
    expect(tokenFromLink('')).toBeNull();
  });
});
