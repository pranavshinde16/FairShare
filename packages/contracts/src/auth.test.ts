import { describe, expect, it } from 'vitest';
import { SignInOptions } from './auth';

describe('SignInOptions', () => {
  it('accepts the server’s shape and drops fields this client doesn’t know', () => {
    expect(SignInOptions.parse({ google: true, apple: false })).toEqual({ google: true });
  });

  it('requires the google flag', () => {
    expect(SignInOptions.safeParse({}).success).toBe(false);
  });
});
