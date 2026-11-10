import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health';

describe('HealthResponse', () => {
  it('accepts a healthy response', () => {
    expect(HealthResponse.parse({ ok: true, db: 'up' })).toEqual({ ok: true, db: 'up' });
  });

  it('rejects unknown keys so nothing extra leaks from the endpoint', () => {
    expect(HealthResponse.safeParse({ ok: true, db: 'up', version: '1.0' }).success).toBe(false);
  });

  it('rejects an unknown database status', () => {
    expect(HealthResponse.safeParse({ ok: true, db: 'maybe' }).success).toBe(false);
  });
});
