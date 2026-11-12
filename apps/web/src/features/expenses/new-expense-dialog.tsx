import { toDecimalString } from '@fairshare/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Skeleton } from '../../components/common/skeleton';
import { Dialog } from '../../components/ui/dialog';
import { uuidv7 } from '../../lib/ids';
import { groupQuery } from '../groups/queries';
import { currenciesQuery, meQuery } from '../profile/queries';
import { expenseDrafts } from './drafts';
import { ExpenseForm, newDraft, type ExpenseDraft } from './expense-form';
import { useCreateExpense } from './use-create-expense';

/**
 * Add expense (Blueprint 7.3), shown by a modal route over the page it was opened from (a group,
 * or a friend), so Back closes it.
 */
export function NewExpenseDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const group = useQuery(groupQuery(groupId));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  // Decided once, when the form opens. A draft the server refused comes back with its ID, so a
  // retry can't create it twice.
  const [draft] = useState(() => expenseDrafts.get(groupId));
  const [id] = useState(() => draft?.body.id ?? uuidv7());

  const currency = currencies.data?.items.find((c) => c.code === group.data?.currency);
  const ready = group.data && me.data && currency;
  const save = useCreateExpense(group.data!, me.data?.id ?? '', currency?.minorUnits ?? 2);

  let initial: ExpenseDraft | undefined;
  if (ready) {
    initial = draft
      ? {
          amountText: toDecimalString(draft.body.amount, currency.minorUnits),
          description: draft.body.description,
          payerId: draft.body.payers[0]!.userId,
          participants: draft.body.split.method === 'equal' ? draft.body.split.participants : [],
          occurredOn: draft.body.occurredOn,
          notes: draft.body.notes ?? '',
        }
      : newDraft(group.data, me.data.id);
  }

  return (
    <Dialog open size="full" title="Add expense" onClose={onClose}>
      {ready && initial ? (
        <ExpenseForm
          id={id}
          group={group.data}
          meId={me.data.id}
          minorUnits={currency.minorUnits}
          symbol={currency.symbol}
          initial={initial}
          error={draft?.error ?? null}
          submitLabel="Save"
          onSubmit={(body, typed) => {
            void save({ id, ...body }, typed);
            onClose();
          }}
        />
      ) : (
        <FormSkeleton />
      )}
    </Dialog>
  );
}

export function FormSkeleton() {
  return <Skeleton className="h-80 w-full rounded-xl" />;
}
