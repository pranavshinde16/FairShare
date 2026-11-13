import type { Context, Env, MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../lib/rate-limit';
import { AppError } from './errors';

/**
 * Answers 429 RATE_LIMITED with Retry-After once `key`'s budget is spent (Blueprint 9.1). The key
 * is the signed-in user for the API, the client IP for public routes.
 */
export function rateLimit<E extends Env>(
  limiter: RateLimiter,
  key: (c: Context<E>) => string,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const result = limiter.consume(key(c));
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfterSeconds));
      throw new AppError('RATE_LIMITED', 'Too many requests. Try again in a minute.');
    }
    await next();
  };
}
