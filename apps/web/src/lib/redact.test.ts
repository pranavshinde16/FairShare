import { describe, expect, it } from 'vitest';
import { redactDeep, redactInviteTokens } from './redact';

const TOKEN = 'BPx_xVBvsLcdBwVJHK_I9a1jXsskIolQXW2hmkHNMpw';

describe('redactInviteTokens', () => {
  it('replaces the token in page and API paths, keeping the rest', () => {
    expect(redactInviteTokens(`https://fairshare.example/invite/${TOKEN}?x=1`)).toBe(
      'https://fairshare.example/invite/[token]?x=1',
    );
    expect(redactInviteTokens(`/api/v1/invites/${TOKEN}/accept`)).toBe(
      '/api/v1/invites/[token]/accept',
    );
  });

  it('leaves other paths alone', () => {
    expect(redactInviteTokens('/groups/123/invites')).toBe('/groups/123/invites');
    expect(redactInviteTokens('/settings')).toBe('/settings');
  });
});

describe('redactDeep', () => {
  it('redacts every string in an event, nested ones included', () => {
    const event = {
      request: { url: `https://app/invite/${TOKEN}` },
      breadcrumbs: [{ data: { from: '/', to: `/invite/${TOKEN}` } }],
      exception: { values: [{ value: `Failed to fetch /api/v1/invites/${TOKEN}` }] },
      level: 'error',
    };
    expect(JSON.stringify(redactDeep(event))).not.toContain(TOKEN);
    expect(redactDeep(event).level).toBe('error');
  });
});
