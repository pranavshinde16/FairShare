import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Dialog } from '../../components/ui/dialog';
import { uuidv7 } from '../../lib/ids';
import { groupQuery } from '../groups/queries';
import { currenciesQuery, meQuery } from '../profile/queries';
import { clearHandoff, peekHandoff } from '../ai/handoff';
import { expenseDrafts } from './drafts';
import { ExpenseForm, newDraft, type ExpenseDraft } from './expense-form';
import { draftFromExpense } from './split-draft';
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
  // A sentence typed on Home for this group, read into the form as it opens (not over a draft).
  const [entryText] = useState(() => (draft ? undefined : peekHandoff(groupId)));
  useEffect(() => clearHandoff(groupId), [groupId]);

  const currency = currencies.data?.items.find((c) => c.code === group.data?.currency);
  const ready = group.data && me.data && currency;
  const loadError = group.error ?? me.error ?? currencies.error;
  const save = useCreateExpense(group.data!, me.data?.id ?? '', currency?.minorUnits ?? 2);

  let initial: ExpenseDraft | undefined;
  if (ready) {
    // A draft the server refused reopens exactly as it was sent.
    initial = draft
      ? draftFromExpense({ ...draft.body, split: draft.body.split }, currency.minorUnits)
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
          entry={{ ...(entryText && { text: entryText }) }}
          onSubmit={(body, typed) => {
            void save({ id, ...body }, typed);
            onClose();
          }}
        />
      ) : loadError ? (
        <ErrorState
          error={loadError}
          onRetry={() => void Promise.all([group.refetch(), me.refetch(), currencies.refetch()])}
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
