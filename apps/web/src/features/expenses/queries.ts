import type { TransactionListQuery } from '@fairshare/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type ListFilters = { q?: string; includeDeleted?: boolean };

/** A group's transactions, newest first, a page at a time. Key: ['group', id, 'transactions', filters]. */
export const transactionsQuery = (groupId: string, filters: ListFilters = {}) =>
  infiniteQueryOptions({
    queryKey: ['group', groupId, 'transactions', filters],
    queryFn: ({ pageParam, signal }) => {
      const query: Partial<TransactionListQuery> = {
        limit: 30,
        ...(pageParam && { cursor: pageParam }),
        ...(filters.q && filters.q.length >= 2 && { q: filters.q }),
        ...(filters.includeDeleted && { includeDeleted: true }),
      };
      return api.transactions(groupId, query, signal);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

export const transactionQuery = (id: string) =>
  queryOptions({
    queryKey: ['transaction', id],
    queryFn: ({ signal }) => api.transaction(id, signal),
  });

export const historyQuery = (id: string) =>
  queryOptions({
    queryKey: ['transaction', id, 'history'],
    queryFn: ({ signal }) => api.transactionHistory(id, signal),
  });
