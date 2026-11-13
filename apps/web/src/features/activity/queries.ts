import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Both live under ['activity'], which every change invalidates (lib/invalidation.ts).

/** My feed, newest first, a page at a time. */
export const activityFeedQuery = infiniteQueryOptions({
  queryKey: ['activity', 'feed'],
  queryFn: ({ pageParam, signal }) =>
    api.activity({ limit: 30, ...(pageParam && { cursor: pageParam }) }, signal),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.nextCursor,
});

/**
 * The unread count for the badge: the smallest page, checked every minute while the app is open
 * (others' changes don't pass through this browser) and whenever the window regains focus.
 */
export const unreadActivityQuery = queryOptions({
  queryKey: ['activity', 'unread'],
  queryFn: ({ signal }) => api.activity({ limit: 1 }, signal),
  select: (feed) => feed.unreadCount,
  refetchInterval: 60_000,
});
