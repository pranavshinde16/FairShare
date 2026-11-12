import { ErrorEnvelope } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { TEST_ORIGIN, testApp } from '../testing/app';
import { MAX_BODY_BYTES } from './guards';

const json = { 'Content-Type': 'application/json' };

describe('the body-size cap', () => {
  it('answers 413 PAYLOAD_TOO_LARGE for a body over 64 KB, on every API path', async () => {
    const { app } = testApp();
    const body = JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES) });

    for (const path of ['/api/v1/me', '/api/auth/sign-in/email-otp']) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { ...json, Origin: TEST_ORIGIN },
        body,
      });
      expect(res.status).toBe(413);
      const envelope = ErrorEnvelope.parse(await res.json());
      expect(envelope.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(envelope.error.requestId).toBe(res.headers.get('X-Request-Id'));
    }
  });

  it('lets a body of exactly 64 KB through', async () => {
    const { app } = testApp();
    const body = 'x'.repeat(MAX_BODY_BYTES);

    const res = await app.request('/api/auth/sign-in/email-otp', { method: 'POST', body });

    expect(res.status).toBe(404); // the fake auth handler answered
  });
});

describe('protectMutations (/api/v1)', () => {
  const patchMe = (headers: Record<string, string>) =>
    testApp().app.request('/api/v1/me', { method: 'PATCH', headers, body: '{}' });

  it('rejects a state-changing request without the app’s Origin with 403 ORIGIN_NOT_ALLOWED', async () => {
    for (const headers of [
      json,
      { ...json, Origin: 'https://evil.example' },
      { ...json, Origin: 'null' },
    ]) {
      const res = await patchMe(headers);
      expect(res.status).toBe(403);
      expect(ErrorEnvelope.parse(await res.json()).error.code).toBe('ORIGIN_NOT_ALLOWED');
    }
  });

  it('rejects a body that isn’t JSON, such as a form post', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data']) {
      const res = await patchMe({ Origin: TEST_ORIGIN, 'Content-Type': type });
      expect(res.status).toBe(400);
      expect(ErrorEnvelope.parse(await res.json()).error).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Send the request body as JSON.',
      });
    }
  });

  it('passes a same-origin JSON request on (here to requireUser, which wants a session)', async () => {
    for (const type of [
      'application/json',
      'application/json; charset=utf-8',
      'application/merge-patch+json',
    ]) {
      const res = await patchMe({ Origin: TEST_ORIGIN, 'Content-Type': type });
      expect(res.status).toBe(401);
    }
  });

  it('leaves reads alone: no Origin is needed for GET', async () => {
    const res = await testApp().app.request('/api/v1/sign-in-options');
    expect(res.status).toBe(200);
  });
});
