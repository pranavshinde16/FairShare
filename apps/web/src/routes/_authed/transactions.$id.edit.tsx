import { ApiError } from '@fairshare/api-client';
import type { Transaction } from '@fairshare/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { balancesQuery } from '../../features/balances/queries';
import { draftFromTransaction, ExpenseForm } from '../../features/expenses/expense-form';
import { transactionQuery } from '../../features/expenses/queries';
import { groupQuery } from '../../features/groups/queries';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { withoutSettlement } from '../../features/settlements/payment';
import { netsOf, SettleDialog } from '../../features/settlements/settle-dialog';
import { draftFromSettlement } from '../../features/settlements/settle-form';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterTransactionChange } from '../../lib/invalidation';
import { useCloseModal } from '../../lib/modal-route';
import { toast } from '../../lib/toast';

/**
 * Edit an expense or a payment: the same form it was made with, pre-filled, sent with If-Match
 * (Blueprint 7.3 "Edit mode"). If someone saved a newer version meanwhile, nothing is overwritten:
 * the person reloads it and makes their change again.
 */
export const Route = createFileRoute('/_authed/transactions/$id/edit')({
  component: EditTransaction,
});

function EditTransaction() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tx = useQuery(transactionQuery(id));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const group = useQuery({ ...groupQuery(tx.data?.groupId ?? ''), enabled: !!tx.data });
  const balances = useQuery({
    ...balancesQuery(tx.data?.groupId ?? ''),
    enabled: tx.data?.type === 'settlement',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const close = useCloseModal(
    () => void navigate({ to: '/transactions/$id', params: { id }, replace: true }),
  );

  const data = tx.data;
  const currency = currencies.data?.items.find((c) => c.code === data?.currency);
  if (!data || !me.data || !group.data || !currency || data.deletedAt) return null;
  const lastChange = data.updatedBy ?? data.createdBy;

  /** After a save: show the new version, refresh what it changes, and go back to it. */
  const saved = async (result: Transaction) => {
    queryClient.setQueryData(transactionQuery(data.id).queryKey, result);
    await afterTransactionChange(queryClient, data.groupId, data.id);
    toast('Changes saved');
    close();
  };
  /** A newer version on the server is a question to reload, not an error in the form. */
  const conflicted = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
      setConflict(true);
      return true;
    }
    return false;
  };

  let form: ReactNode;
  if (data.type === 'settlement') {
    if (!balances.data) return null;
    const settlement = data;
    form = (
      <SettleDialog
        // A newer version reloads the form with it.
        key={data.version}
        open={!conflict}
        title="Edit payment"
        description={`Last changed by ${lastChange.name}`}
        group={group.data}
        meId={me.data.id}
        minorUnits={currency.minorUnits}
        symbol={currency.symbol}
        initial={draftFromSettlement(settlement, currency.minorUnits)}
        // Checked against the balances as they'd be without this payment.
        nets={withoutSettlement(netsOf(balances.data, data.currency), {
          fromUserId: settlement.payers[0].userId,
          toUserId: settlement.shares[0].userId,
          amount: settlement.amount,
        })}
        // Today's suggestions already count this payment, so they'd mislead here.
        suggested={() => null}
        submitLabel="Save changes"
        confirmLabel="Save anyway"
        onSubmit={async (body) => {
          try {
            await saved(await api.updateSettlement(data.id, data.version, body));
          } catch (err) {
            if (!conflicted(err)) throw err;
          }
        }}
        onClose={close}
      />
    );
  } else {
    form = (
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
              .then(saved)
              .catch((err: unknown) => {
                if (!conflicted(err)) setError(errorMessage(err));
              })
              .finally(() => setBusy(false));
          }}
        />
      </Dialog>
    );
  }

  const noun = data.type === 'settlement' ? 'payment' : 'expense';
  return (
    <>
      {form}
      <Dialog
        open={conflict}
        title={`Someone changed this ${noun}`}
        description="Your changes weren’t saved, so nothing of theirs was lost. Reload to see their version, then make your change again."
        onClose={close}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void Promise.all([
                tx.refetch(),
                data.type === 'settlement' && balances.refetch(),
              ]).then(() => setConflict(false));
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
