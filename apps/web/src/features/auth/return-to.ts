/** Where to go after signing in when nothing (valid) was asked for. */
export const HOME = '/';

/**
 * Accepts only a path on this site ("/settings?tab=x"), so a crafted sign-in link can't send
 * someone to another site after they sign in. Anything else, the sign-in pages included, is Home.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return HOME;
  // "//evil.example" and "/\evil.example" are protocol-relative URLs to another host.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return HOME;
  let url: URL;
  try {
    url = new URL(value, 'https://fairshare.invalid');
  } catch {
    return HOME;
  }
  if (url.origin !== 'https://fairshare.invalid') return HOME;
  if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return HOME;
  return url.pathname + url.search + url.hash;
}
