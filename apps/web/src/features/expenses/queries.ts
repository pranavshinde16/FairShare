import type { TransactionListQuery } from '@fairshare/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { compact, type HistoryFilters } from './filters';

/**
 * A group's transactions, newest first, a page at a time, narrowed by the history filters.
 * Key: ['group', id, 'transactions', filters].
 */
export const transactionsQuery = (groupId: string, filters: HistoryFilters = {}) =>
  infiniteQueryOptions({
    queryKey: ['group', groupId, 'transactions', compact(filters)],
    queryFn: ({ pageParam, signal }) => {
      const q = filters.q?.trim();
      const query: Partial<TransactionListQuery> = {
        limit: 30,
        ...(pageParam && { cursor: pageParam }),
        // The API searches from 2 characters; one is no search yet.
        ...(q && q.length >= 2 && { q }),
        ...(filters.person && { person: filters.person }),
        ...(filters.type && { type: filters.type }),
        ...(filters.from && { from: filters.from }),
        ...(filters.to && { to: filters.to }),
        ...(filters.deleted && { includeDeleted: true }),
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
