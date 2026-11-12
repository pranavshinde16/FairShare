import {
  AcceptInviteResponse,
  AddFriendResponse,
  ClaimList,
  ClaimResponse,
  CurrencyList,
  FriendDetail,
  FriendList,
  Group,
  GroupBalances,
  GroupList,
  HealthResponse,
  Home,
  InviteCreated,
  InvitePreview,
  Member,
  PeopleList,
  Profile,
  SignInOptions,
  DeletedTransaction,
  Transaction,
  TransactionHistory,
  TransactionPage,
  type AcceptInvite,
  type AddFriend,
  type AddMember,
  type CreateGroup,
  type CreateExpense,
  type CreateSettlement,
  type CreateInvite,
  type TransactionListQuery,
  type UpdateExpense,
  type UpdateSettlement,
  type UpdateGroup,
  type UpdateProfile,
} from '@fairshare/contracts';
import { createTransport, type TransportOptions } from './transport';

export type ApiClientOptions = TransportOptions;

/**
 * The typed FairShare API. Methods are added here as their endpoints land. Sign-in itself (email
 * codes, Google, sign-out) goes through Better Auth's own client at /api/auth/*, not this one.
 */
export function createApiClient(options: ApiClientOptions) {
  const { request, requestNoContent } = createTransport(options);

  return {
    health: (signal?: AbortSignal) => request(HealthResponse, '/api/health', { signal }),

    /** Public: which sign-in methods to offer. */
    signInOptions: (signal?: AbortSignal) =>
      request(SignInOptions, '/api/v1/sign-in-options', { signal }),

    currencies: (signal?: AbortSignal) => request(CurrencyList, '/api/v1/currencies', { signal }),

    me: (signal?: AbortSignal) => request(Profile, '/api/v1/me', { signal }),
    updateMe: (body: UpdateProfile) => request(Profile, '/api/v1/me', { method: 'PATCH', body }),

    groups: (signal?: AbortSignal) => request(GroupList, '/api/v1/groups', { signal }),
    group: (groupId: string, signal?: AbortSignal) =>
      request(Group, `/api/v1/groups/${seg(groupId)}`, { signal }),
    createGroup: (body: CreateGroup) => request(Group, '/api/v1/groups', { method: 'POST', body }),
    updateGroup: (groupId: string, body: UpdateGroup) =>
      request(Group, `/api/v1/groups/${seg(groupId)}`, { method: 'PATCH', body }),
    deleteGroup: (groupId: string) =>
      requestNoContent(`/api/v1/groups/${seg(groupId)}`, { method: 'DELETE' }),

    addMember: (groupId: string, body: AddMember) =>
      request(Member, `/api/v1/groups/${seg(groupId)}/members`, { method: 'POST', body }),
    /** Removes someone (the owner does this), or with userId "me", leaves the group. */
    removeMember: (groupId: string, userId: string) =>
      requestNoContent(`/api/v1/groups/${seg(groupId)}/members/${seg(userId)}`, {
        method: 'DELETE',
      }),

    createInvite: (groupId: string, body: CreateInvite = {}) =>
      request(InviteCreated, `/api/v1/groups/${seg(groupId)}/invites`, { method: 'POST', body }),
    revokeInvite: (groupId: string, inviteId: string) =>
      requestNoContent(`/api/v1/groups/${seg(groupId)}/invites/${seg(inviteId)}`, {
        method: 'DELETE',
      }),
    /** Public: what an invite link leads to. */
    invitePreview: (token: string, signal?: AbortSignal) =>
      request(InvitePreview, `/api/v1/invites/${seg(token)}`, { signal }),
    acceptInvite: (token: string, body: AcceptInvite = {}) =>
      request(AcceptInviteResponse, `/api/v1/invites/${seg(token)}/accept`, {
        method: 'POST',
        body,
      }),

    home: (signal?: AbortSignal) => request(Home, '/api/v1/home', { signal }),
    groupBalances: (groupId: string, signal?: AbortSignal) =>
      request(GroupBalances, `/api/v1/groups/${seg(groupId)}/balances`, { signal }),

    friends: (signal?: AbortSignal) => request(FriendList, '/api/v1/friends', { signal }),
    friend: (userId: string, signal?: AbortSignal) =>
      request(FriendDetail, `/api/v1/friends/${seg(userId)}`, { signal }),
    addFriend: (body: AddFriend) =>
      request(AddFriendResponse, '/api/v1/friends', { method: 'POST', body }),
    people: (signal?: AbortSignal) => request(PeopleList, '/api/v1/people', { signal }),

    /** A page of a group's transactions, newest first; pass nextCursor back for the next one. */
    transactions: (
      groupId: string,
      query: Partial<TransactionListQuery> = {},
      signal?: AbortSignal,
    ) => request(TransactionPage, `/api/v1/groups/${seg(groupId)}/transactions`, { query, signal }),
    createExpense: (groupId: string, body: CreateExpense) =>
      request(Transaction, `/api/v1/groups/${seg(groupId)}/expenses`, { method: 'POST', body }),
    /** Records "from paid to" in the group. */
    createSettlement: (groupId: string, body: CreateSettlement) =>
      request(Transaction, `/api/v1/groups/${seg(groupId)}/settlements`, { method: 'POST', body }),
    transaction: (id: string, signal?: AbortSignal) =>
      request(Transaction, `/api/v1/transactions/${seg(id)}`, { signal }),
    /** Replaces an expense; `version` is the one the edit started from (If-Match). */
    updateExpense: (id: string, version: number, body: UpdateExpense) =>
      request(Transaction, `/api/v1/transactions/${seg(id)}`, {
        method: 'PUT',
        body,
        ifMatch: version,
      }),
    /** Replaces a settlement; `version` is the one the edit started from (If-Match). */
    updateSettlement: (id: string, version: number, body: UpdateSettlement) =>
      request(Transaction, `/api/v1/transactions/${seg(id)}`, {
        method: 'PUT',
        body,
        ifMatch: version,
      }),
    deleteTransaction: (id: string, version: number) =>
      request(DeletedTransaction, `/api/v1/transactions/${seg(id)}`, {
        method: 'DELETE',
        ifMatch: version,
      }),
    restoreTransaction: (id: string, version: number) =>
      request(Transaction, `/api/v1/transactions/${seg(id)}/restore`, {
        method: 'POST',
        ifMatch: version,
      }),
    transactionHistory: (id: string, signal?: AbortSignal) =>
      request(TransactionHistory, `/api/v1/transactions/${seg(id)}/history`, { signal }),

    claims: (signal?: AbortSignal) => request(ClaimList, '/api/v1/claims', { signal }),
    claim: (placeholderId: string) =>
      request(ClaimResponse, `/api/v1/claims/${seg(placeholderId)}`, { method: 'POST' }),
    dismissClaim: (placeholderId: string) =>
      requestNoContent(`/api/v1/claims/${seg(placeholderId)}`, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** A path segment, encoded so an ID can't change the path. */
const seg = (value: string) => encodeURIComponent(value);
