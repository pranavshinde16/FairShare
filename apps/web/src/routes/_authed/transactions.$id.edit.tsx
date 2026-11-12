import { ApiError } from '@fairshare/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import {
  draftFromTransaction,
  ExpenseForm,
  isEditableHere,
} from '../../features/expenses/expense-form';
import { afterTransactionChange, transactionQuery } from '../../features/expenses/queries';
import { groupQuery } from '../../features/groups/queries';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../lib/toast';

/** Edit expense: the same form, pre-filled, sent with If-Match (Blueprint 7.3 "Edit mode"). */
export const Route = createFileRoute('/_authed/transactions/$id/edit')({
  component: EditExpense,
});

function EditExpense() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tx = useQuery(transactionQuery(id));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const group = useQuery({ ...groupQuery(tx.data?.groupId ?? ''), enabled: !!tx.data });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const close = () => void navigate({ to: '/transactions/$id', params: { id } });

  const data = tx.data;
  const currency = currencies.data?.items.find((c) => c.code === data?.currency);
  if (!data || !me.data || !group.data || !currency) return null;
  if (!isEditableHere(data) || data.deletedAt) return null;
  const lastChange = data.updatedBy ?? data.createdBy;

  return (
    <>
      <Dialog
        open={!conflict}
        size="full"
        title="Edit expense"
        description={`Last changed by ${lastChange.name}`}
        onClose={close}
      >
        <ExpenseForm
          // A newer version reloads the form with it.
          key={data.version}
          id={data.id}
          group={group.data}
          meId={me.data.id}
          minorUnits={currency.minorUnits}
          symbol={currency.symbol}
          initial={draftFromTransaction(data, currency.minorUnits)}
          submitLabel="Save changes"
          busy={busy}
          error={error}
          onSubmit={(body) => {
            setBusy(true);
            setError(null);
            api
              .updateExpense(data.id, data.version, body)
              .then(async (saved) => {
                queryClient.setQueryData(transactionQuery(data.id).queryKey, saved);
                await afterTransactionChange(queryClient, data.groupId, data.id);
                toast('Changes saved');
                close();
              })
              .catch((err: unknown) => {
                if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') setConflict(true);
                else setError(errorMessage(err));
              })
              .finally(() => setBusy(false));
          }}
        />
      </Dialog>
      <Dialog
        open={conflict}
        title="Someone changed this expense"
        description="Your changes weren’t saved, so nothing of theirs was lost. Reload to see their version, then make your change again."
        onClose={close}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void tx.refetch().then(() => setConflict(false));
              void queryClient.invalidateQueries({ queryKey: ['transaction', id, 'history'] });
            }}
          >
            Reload
          </Button>
        </div>
      </Dialog>
    </>
  );
}
