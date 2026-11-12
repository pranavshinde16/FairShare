export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = { consume: (key: string) => RateLimitResult };

export type RateLimiterOptions = {
  /** Requests allowed per key in one window. */
  max: number;
  windowMs: number;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Expired keys are swept once this many are tracked, so memory stays bounded. */
  maxKeys?: number;
};

/**
 * A fixed-window counter per key, in memory. That's enough with one server instance (Railway runs
 * one replica); more replicas would need a shared store.
 */
export function createRateLimiter({
  max,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function sweep(at: number) {
    for (const [key, window] of windows) if (window.resetAt <= at) windows.delete(key);
  }

  return {
    consume(key) {
      const at = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= at) {
        if (windows.size >= maxKeys) sweep(at);
        window = { count: 0, resetAt: at + windowMs };
        windows.set(key, window);
      }
      if (window.count >= max) {
        return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - at) / 1000) };
      }
      window.count++;
      return { allowed: true };
    },
  };
}
