import type { Context } from 'hono';

/**
 * The client's IP from the configured proxy headers (CLIENT_IP_HEADERS), for per-IP rate limits.
 * Only a single-address value is trusted, as in Better Auth: a list could have been started by the
 * client. Without one, every caller shares the "unknown" key, which still bounds the total.
 */
export function clientIp(c: Context, headers: string[]): string {
  for (const name of headers) {
    const value = c.req.header(name)?.trim();
    if (value && !value.includes(',')) return value;
  }
  return 'unknown';
}
