import type { AddMember, CreateGroup, UpdateGroup } from '@fairshare/contracts';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Query keys (Blueprint 7.1): ['groups'], ['group', id], ['friends'], ['people'], ['claims'].
export const groupsQuery = queryOptions({
  queryKey: ['groups'],
  queryFn: ({ signal }) => api.groups(signal),
});

export const groupQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['group', groupId],
    queryFn: ({ signal }) => api.group(groupId, signal),
  });

export const friendsQuery = queryOptions({
  queryKey: ['friends'],
  queryFn: ({ signal }) => api.friends(signal),
});

export const peopleQuery = queryOptions({
  queryKey: ['people'],
  queryFn: ({ signal }) => api.people(signal),
});

export const claimsQuery = queryOptions({
  queryKey: ['claims'],
  queryFn: ({ signal }) => api.claims(signal),
});

/** After anything that changes who is in which group. */
export async function refreshMemberships(queryClient: QueryClient, groupId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['groups'] }),
    queryClient.invalidateQueries({ queryKey: ['friends'] }),
    queryClient.invalidateQueries({ queryKey: ['people'] }),
    queryClient.invalidateQueries({ queryKey: ['claims'] }),
    groupId && queryClient.invalidateQueries({ queryKey: ['group', groupId] }),
  ]);
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGroup) => api.createGroup(body),
    onSuccess: async (group) => {
      queryClient.setQueryData(groupQuery(group.id).queryKey, group);
      await refreshMemberships(queryClient);
    },
  });
}

export function useUpdateGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGroup) => api.updateGroup(groupId, body),
    onSuccess: async (group) => {
      queryClient.setQueryData(groupQuery(groupId).queryKey, group);
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

export function useAddMember(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMember) => api.addMember(groupId, body),
    onSuccess: () => refreshMemberships(queryClient, groupId),
  });
}
