// Optimistic concurrency: PUT, DELETE and restore on a transaction send `If-Match: "<version>"`.
// The API rejects a stale version with 409 VERSION_CONFLICT and a missing one with 428.

/** The If-Match header value for a version: `"3"`. */
export function formatIfMatch(version: number): string {
  return `"${version}"`;
}

/**
 * Reads the version from an If-Match header. Accepts `"3"` and a bare `3`. Returns null for anything
 * else: a missing header, `*`, a weak tag such as `W/"3"`, a list, or a version that isn't a
 * positive integer that fits the column.
 */
export function parseIfMatch(header: string | null | undefined): number | null {
  const match = /^\s*(?:"(\d{1,10})"|(\d{1,10}))\s*$/.exec(header ?? '');
  if (!match) return null;
  const version = Number(match[1] ?? match[2]);
  return version >= 1 && version <= 2_147_483_647 ? version : null;
}
