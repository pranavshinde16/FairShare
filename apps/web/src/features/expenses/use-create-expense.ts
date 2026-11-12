import type { CreateExpense, Group, Transaction, TransactionPage } from '@fairshare/contracts';
import { computeShares, formatMoney } from '@fairshare/core';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterTransactionChange } from '../../lib/invalidation';
import { toast } from '../../lib/toast';
import { expenseDrafts } from './drafts';
import { rememberDefaults, type ExpenseDraft } from './expense-form';
import { transactionsQuery } from './queries';

// IDs of expenses saved optimistically and not yet confirmed: the list shows them as "Saving…".
const pending = new Set<string>();
const listeners = new Set<() => void>();
const setPending = (id: string, on: boolean) => {
  if (on) pending.add(id);
  else pending.delete(id);
  listeners.forEach((l) => l());
};

export function useIsPending(id: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending.has(id),
  );
}

/**
 * Saves a new expense optimistically (Blueprint 4.4): it appears in the list at once with an
 * "Added · Undo" toast while the request runs. If the server refuses it or can't be reached, the
 * list rolls back and the form can be reopened with everything as typed (and the same ID, so a
 * retry can't create it twice).
 */
export function useCreateExpense(group: Group, meId: string, minorUnits: number) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return async (body: CreateExpense, draft: ExpenseDraft) => {
    const listKey = transactionsQuery(group.id).queryKey;
    await queryClient.cancelQueries({ queryKey: ['group', group.id, 'transactions'] });
    const previous = queryClient.getQueryData<InfiniteData<TransactionPage>>(listKey);
    queryClient.setQueryData<InfiniteData<TransactionPage>>(listKey, (data) => {
      if (!data || data.pages.length === 0) return data;
      const [first, ...rest] = data.pages;
      return {
        ...data,
        pages: [{ ...first!, items: [optimistic(body, group, meId), ...first!.items] }, ...rest],
      };
    });
    setPending(body.id, true);
    expenseDrafts.clear(group.id);

    const amount = formatMoney(body.amount, minorUnits, Intl, {
      locale: navigator.language,
      currency: body.currency,
    });
    const saving = api.createExpense(group.id, body);
    toast(`Added ‘${body.description}’ · ${amount}`, {
      action: {
        label: 'Undo',
        run: () => {
          void (async () => {
            try {
              const saved = await saving;
              await api.deleteTransaction(saved.id, saved.version);
              await afterTransactionChange(queryClient, group.id, saved.id);
              toast(`Removed ‘${body.description}’`);
            } catch (error) {
              toast(errorMessage(error), { tone: 'error' });
            }
          })();
        },
      },
    });

    try {
      await saving;
      rememberDefaults(group.id, draft);
    } catch (error) {
      queryClient.setQueryData(listKey, previous);
      expenseDrafts.set(group.id, { body, error: errorMessage(error) });
      toast(`Couldn’t save ‘${body.description}’`, {
        tone: 'error',
        durationMs: 12_000,
        action: {
          label: 'Open',
          run: () => {
            // A friendship's form opens over the friend's page.
            const friend =
              group.kind === 'direct' ? group.members.find((m) => m.user.id !== meId) : undefined;
            void (friend
              ? navigate({
                  to: '/friends/$userId/expenses/new',
                  params: { userId: friend.user.id },
                })
              : navigate({ to: '/groups/$groupId/expenses/new', params: { groupId: group.id } }));
          },
        },
      });
    } finally {
      setPending(body.id, false);
      await afterTransactionChange(queryClient, group.id);
    }
  };
}

/** The list row shown while the save is in flight, built exactly as the server will build it. */
function optimistic(body: CreateExpense, group: Group, meId: string): Transaction {
  const shares = computeShares(body.amount, body.split, body.id);
  const me = group.members.find((m) => m.user.id === meId)!.user;
  const paid = body.payers.filter((p) => p.userId === meId).reduce((s, p) => s + p.amount, 0);
  const owed = shares.filter((s) => s.userId === meId).reduce((s, l) => s + l.amount, 0);
  return {
    id: body.id,
    groupId: group.id,
    type: 'expense',
    description: body.description,
    notes: body.notes ?? null,
    amount: body.amount,
    currency: body.currency,
    occurredOn: body.occurredOn,
    splitMethod: body.split.method,
    splitInput: body.split,
    payers: body.payers,
    shares,
    paymentMethod: null,
    paymentRef: null,
    createdBy: me,
    updatedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    deletedAt: null,
    version: 1,
    myNet: paid - owed,
  };
}
