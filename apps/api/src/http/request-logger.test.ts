import { describe, expect, it } from 'vitest';
import { testApp } from '../testing/app';
import { redactPath } from './request-logger';

describe('redactPath', () => {
  it.each([
    ['/invite/AbC-123_xyz', '/invite/[token]'],
    ['/api/v1/invites/AbC-123_xyz', '/api/v1/invites/[token]'],
    ['/api/v1/invites/AbC-123_xyz/accept', '/api/v1/invites/[token]/accept'],
    ['/api/v1/groups/9f1c/invites', '/api/v1/groups/9f1c/invites'],
    ['/groups/9f1c', '/groups/9f1c'],
  ])('%s → %s', (path, logged) => {
    expect(redactPath(path)).toBe(logged);
  });
});

describe('the request log', () => {
  it('never contains an invite token', async () => {
    const { app, logs } = testApp();

    await app.request('/api/v1/invites/s3cret-token/accept', { method: 'POST' });

    expect(logs[0]).toMatchObject({ path: '/api/v1/invites/[token]/accept' });
    expect(JSON.stringify(logs)).not.toContain('s3cret-token');
  });
});
