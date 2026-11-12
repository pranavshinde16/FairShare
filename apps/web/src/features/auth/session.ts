import { queryOptions } from '@tanstack/react-query';
import { authClient } from '../../lib/auth-client';
import { readStored, writeStored } from '../../lib/storage';

/** The Better Auth session, or null when signed out. The route guards read it from the cache. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(error.message ?? 'Could not check the session');
    return data ?? null;
  },
  staleTime: 5 * 60_000,
});

// The address a code was sent to and when, kept for the verify step. Session storage: this tab
// only, gone when it closes, and never in the URL (where it would land in browser history).
const PENDING_KEY = 'fairshare.sign-in';

export type PendingSignIn = { email: string; sentAt: number };

export const pendingSignIn = {
  get(): PendingSignIn | null {
    try {
      const value = JSON.parse(readStored('session', PENDING_KEY) ?? 'null') as unknown;
      const { email, sentAt } = (value ?? {}) as Partial<PendingSignIn>;
      return typeof email === 'string' && typeof sentAt === 'number' ? { email, sentAt } : null;
    } catch {
      return null;
    }
  },
  /** Records that a code was just sent to `email`. */
  set(email: string) {
    writeStored('session', PENDING_KEY, JSON.stringify({ email, sentAt: Date.now() }));
  },
  clear: () => writeStored('session', PENDING_KEY, null),
};
