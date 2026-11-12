import type { AddMember, CreateGroup, UpdateGroup } from '@fairshare/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { afterGroupChange, afterMembershipChange } from '../../lib/invalidation';

// Query keys (Blueprint 7.1): ['group', id], ['people'], ['claims']. The lists of groups and
// friends come from ['home'] (features/balances/queries.ts).
// What each change invalidates is in lib/invalidation.ts.
export const groupQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['group', groupId],
    queryFn: ({ signal }) => api.group(groupId, signal),
  });

export const peopleQuery = queryOptions({
  queryKey: ['people'],
  queryFn: ({ signal }) => api.people(signal),
});

export const claimsQuery = queryOptions({
  queryKey: ['claims'],
  queryFn: ({ signal }) => api.claims(signal),
});

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGroup) => api.createGroup(body),
    onSuccess: async (group) => {
      queryClient.setQueryData(groupQuery(group.id).queryKey, group);
      await afterMembershipChange(queryClient, group.id);
    },
  });
}

export function useUpdateGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateGroup) => api.updateGroup(groupId, body),
    onSuccess: async (group) => {
      queryClient.setQueryData(groupQuery(groupId).queryKey, group);
      await afterGroupChange(queryClient, groupId);
    },
  });
}

export function useAddMember(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMember) => api.addMember(groupId, body),
    onSuccess: () => afterMembershipChange(queryClient, groupId),
  });
}
