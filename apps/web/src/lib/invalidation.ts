import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * What each kind of change makes stale (Blueprint 7.1), in one place so no mutation forgets a
 * screen. Invalidating refetches only the queries on screen; the rest refetch when next shown.
 * Keys are prefixes: ['group', id] covers that group, its balances and its transaction lists;
 * ['friend'] covers every friend page; ['transaction', id] covers its history.
 *
 * Home (['home']) carries the lists of groups and people, so it stands in for the plan's
 * ['groups'] and ['friends'] keys.
 *
 * | Change                                                | Stale                                  |
 * | ----------------------------------------------------- | -------------------------------------- |
 * | An expense or settlement added, edited, deleted or    | group G, home, every friend page,      |
 * | restored in group G                                   | activity, the transaction              |
 * | Someone joins or leaves, a group created or deleted,  | the group (every group for a claim,    |
 * | a friend added, a placeholder claimed                 | which can reach several), home, friend |
 * |                                                       | pages, people, claims, activity        |
 * | A group's name, emoji or currency                     | the group, home, friend pages (they    |
 * |                                                       | show group names), activity            |
 * | My profile (name, picture)                            | everything but the profile itself and  |
 * |                                                       | reference data                         |
 */
export async function afterTransactionChange(
  queryClient: QueryClient,
  groupId: string,
  transactionId?: string,
) {
  await invalidate(queryClient, [
    ['group', groupId],
    ['home'],
    ['friend'],
    ['activity'],
    ...(transactionId ? [['transaction', transactionId]] : []),
  ]);
}

/** After a change to who is in which group. Without a group ID, every group is refreshed. */
export async function afterMembershipChange(queryClient: QueryClient, groupId?: string) {
  await invalidate(queryClient, [
    groupId ? ['group', groupId] : ['group'],
    ['home'],
    ['friend'],
    ['people'],
    ['claims'],
    ['activity'],
  ]);
}

/** After a group's name, emoji or currency changes. */
export async function afterGroupChange(queryClient: QueryClient, groupId: string) {
  await invalidate(queryClient, [['group', groupId], ['home'], ['friend'], ['activity']]);
}

/** After my profile changes: my name and picture show up across the app. */
export async function afterProfileChange(queryClient: QueryClient) {
  const keep = new Set(['me', 'session', 'currencies']);
  await queryClient.invalidateQueries({
    predicate: (query) => !keep.has(String(query.queryKey[0])),
  });
}

async function invalidate(queryClient: QueryClient, keys: QueryKey[]) {
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
