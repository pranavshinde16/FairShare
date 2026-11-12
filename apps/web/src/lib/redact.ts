/**
 * Invite tokens are bearer secrets that travel in URLs (/invite/<token>, /api/v1/invites/<token>).
 * The server's logs already show `[token]`; this does the same for anything the browser reports.
 */
export const redactInviteTokens = (text: string) =>
  text.replace(/(\/invites?\/)[A-Za-z0-9_-]+/g, '$1[token]');

/** Redacts every string inside a JSON-shaped value, such as an error-tracking event. */
export function redactDeep<T>(value: T): T {
  return JSON.parse(redactInviteTokens(JSON.stringify(value))) as T;
}
