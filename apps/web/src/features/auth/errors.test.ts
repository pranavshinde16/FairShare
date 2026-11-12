import { describe, expect, it } from 'vitest';
import { googleErrorMessage, signInErrorMessage } from './errors';

describe('signInErrorMessage', () => {
  it('uses specific copy for known codes', () => {
    expect(signInErrorMessage({ code: 'INVALID_OTP', status: 400 })).toBe('Code is incorrect.');
    expect(signInErrorMessage({ code: 'OTP_EXPIRED', status: 400 })).toBe('Code expired.');
    expect(signInErrorMessage({ code: 'TOO_MANY_CODES', status: 429 })).toMatch(/Too many codes/);
  });

  it('falls back on the status, and treats no status as a network failure', () => {
    expect(signInErrorMessage({ status: 429 })).toMatch(/Wait a minute/);
    expect(signInErrorMessage({ status: 500, message: 'internal details' })).toBe(
      'Something went wrong. Try again.',
    );
    expect(signInErrorMessage({})).toMatch(/connection/);
  });
});

describe('googleErrorMessage', () => {
  it('says plainly what happened', () => {
    expect(googleErrorMessage('access_denied')).toBe('Google sign-in was cancelled.');
    expect(googleErrorMessage('state_mismatch')).toMatch(/didn’t finish/);
  });
});
