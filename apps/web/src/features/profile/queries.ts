import type { Profile, UpdateProfile } from '@fairshare/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: ({ signal }) => api.me(signal),
});

/** Reference data that changes only with a deploy. */
export const currenciesQuery = queryOptions({
  queryKey: ['currencies'],
  queryFn: ({ signal }) => api.currencies(signal),
  staleTime: Infinity,
});

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateProfile) => api.updateMe(changes),
    onSuccess: (profile: Profile) => queryClient.setQueryData(meQuery.queryKey, profile),
  });
}
