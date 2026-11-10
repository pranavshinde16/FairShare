import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;

/**
 * An opaque keyset cursor. The server encodes its position (for example occurredOn and id) in
 * base64url; clients only pass it back.
 */
export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/, 'Invalid cursor');

/** ?cursor=&limit= as they arrive in a query string. */
export const PageQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: z.coerce
    .number<string | number>()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT),
});

/** A page of results. nextCursor is null on the last page. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: Cursor.nullable() });
}
