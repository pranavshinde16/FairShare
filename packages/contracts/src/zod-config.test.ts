import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { Profile } from './index';

describe('zod settings', () => {
  it('builds every schema jitless, so the browser never tries eval under the CSP', () => {
    expect(Profile).toBeDefined();
    expect(z.config().jitless).toBe(true);
  });
});
