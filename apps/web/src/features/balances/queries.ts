import { queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Query keys (Blueprint 7.1): ['home'], ['group', id, 'balances'], ['friend', userId]. What each
// change invalidates is in lib/invalidation.ts.
export const homeQuery = queryOptions({
  queryKey: ['home'],
  queryFn: ({ signal }) => api.home(signal),
});

export const balancesQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['group', groupId, 'balances'],
    queryFn: ({ signal }) => api.groupBalances(groupId, signal),
  });

export const friendQuery = (userId: string) =>
  queryOptions({
    queryKey: ['friend', userId],
    queryFn: ({ signal }) => api.friend(userId, signal),
  });
