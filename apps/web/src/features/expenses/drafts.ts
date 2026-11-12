import type { CreateExpense } from '@fairshare/contracts';

/**
 * An expense the form closed on (the save is optimistic) but the server refused or never got.
 * Reopening the form for the group restores it, with the same ID, so a retry can't add it twice.
 */
type Draft = { body: CreateExpense; error: string };

const drafts = new Map<string, Draft>();

export const expenseDrafts = {
  get: (groupId: string) => drafts.get(groupId),
  set: (groupId: string, draft: Draft) => drafts.set(groupId, draft),
  clear: (groupId: string) => drafts.delete(groupId),
};
