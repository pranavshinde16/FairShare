import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toDecimalString } from '@fairshare/core';
import { useState } from 'react';
import { Skeleton } from '../../components/common/skeleton';
import { Dialog } from '../../components/ui/dialog';
import { expenseDrafts } from '../../features/expenses/drafts';
import { ExpenseForm, newDraft, type ExpenseDraft } from '../../features/expenses/expense-form';
import { useCreateExpense } from '../../features/expenses/use-create-expense';
import { groupQuery } from '../../features/groups/queries';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { uuidv7 } from '../../lib/ids';

/** Add expense: a modal route over the group (Blueprint 7.3), so Back closes it. */
export const Route = createFileRoute('/_authed/groups/$groupId/expenses/new')({
  component: NewExpense,
});

function NewExpense() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const group = useQuery(groupQuery(groupId));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  // Decided once, when the form opens. A draft the server refused comes back with its ID, so a
  // retry can't create it twice.
  const [draft] = useState(() => expenseDrafts.get(groupId));
  const [id] = useState(() => draft?.body.id ?? uuidv7());
  const close = () =>
    void navigate({ to: '/groups/$groupId', params: { groupId }, search: { tab: 'expenses' } });

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
    <Dialog open size="full" title="Add expense" onClose={close}>
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
            close();
          }}
        />
      ) : (
        <Skeleton className="h-80 w-full rounded-xl" />
      )}
    </Dialog>
  );
}
