import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createRateLimiter', () => {
  it('allows max requests per window, then says when to retry', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: time.now });

    expect(limiter.consume('a')).toEqual({ allowed: true });
    expect(limiter.consume('a')).toEqual({ allowed: true });
    time.advance(15_500);
    expect(limiter.consume('a')).toEqual({ allowed: false, retryAfterSeconds: 45 });
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: clock().now });

    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('b').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(false);
  });

  it('starts a fresh window once the old one ends', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000, now: time.now });

    limiter.consume('a');
    time.advance(60_000);
    expect(limiter.consume('a')).toEqual({ allowed: true });
  });

  it('forgets expired keys once it tracks maxKeys, without losing live ones', () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: time.now, maxKeys: 2 });

    limiter.consume('old');
    time.advance(1_000);
    limiter.consume('live');
    limiter.consume('new'); // sweeps 'old'; 'live' keeps its count
    expect(limiter.consume('live').allowed).toBe(false);
    expect(limiter.consume('old').allowed).toBe(true);
  });
});
