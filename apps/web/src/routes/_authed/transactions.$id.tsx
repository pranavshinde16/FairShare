import { ApiError } from '@fairshare/api-client';
import type { SplitInput } from '@fairshare/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Pencil, Receipt, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { ConfirmDialog } from '../../components/common/confirm-dialog';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { describeEntry, shortDate } from '../../features/expenses/history';
import { historyQuery, transactionQuery } from '../../features/expenses/queries';
import { groupQuery } from '../../features/groups/queries';
import { groupTitle } from '../../features/groups/title';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { percentText } from '../../features/expenses/split-draft';
import { methodLabel, paymentSentence } from '../../features/settlements/payment';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterTransactionChange } from '../../lib/invalidation';
import { formatAmount } from '../../lib/money';
import { useMarkModalOpen } from '../../lib/modal-route';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';

/**
 * Blueprint 7.2 "Expense details": the amounts, who paid, each share, my effect, history. A payment
 * shows who paid whom, how, and its reference.
 */
export const Route = createFileRoute('/_authed/transactions/$id')({
  component: TransactionPage,
});

function TransactionPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tx = useQuery(transactionQuery(id));
  const history = useQuery(historyQuery(id));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const group = useQuery({ ...groupQuery(tx.data?.groupId ?? ''), enabled: !!tx.data });
  const [deleting, setDeleting] = useState(false);
  const markModal = useMarkModalOpen();
  const [restoring, setRestoring] = useState(false);

  if (tx.error instanceof ApiError && tx.error.status === 404) {
    return (
      <EmptyState icon={Receipt} title="Not found">
        It doesn’t exist, or you’re not in its group.
      </EmptyState>
    );
  }
  if (tx.error) return <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />;
  if (!tx.data || !me.data || !group.data || !currencies.data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const data = tx.data;
  const meId = me.data.id;
  const minorUnits = currencies.data.items.find((c) => c.code === data.currency)?.minorUnits ?? 2;
  const money = (amount: number) => formatAmount(amount, data.currency, minorUnits);
  const nameOf = (userId: string) =>
    userId === meId
      ? 'You'
      : (group.data.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone');
  const person = (userId: string) => group.data.members.find((m) => m.user.id === userId)?.user;
  const lastChange = data.updatedBy ?? data.createdBy;
  // A friendship's expenses live on the friend's page.
  const friend =
    group.data.kind === 'direct'
      ? group.data.members.find((m) => m.user.id !== meId)?.user
      : undefined;
  const deleted = data.deletedAt !== null;
  const settlement = data.type === 'settlement';
  // "‘Dinner’" for an expense, "the payment" for a settlement, in toasts and the delete question.
  const what = settlement ? 'the payment' : `‘${data.description}’`;
  const title =
    data.type === 'settlement'
      ? paymentSentence(data.payers[0].userId, data.shares[0].userId, meId, nameOf)
      : data.description;

  async function restore() {
    setRestoring(true);
    try {
      const restored = await api.restoreTransaction(data.id, data.version);
      queryClient.setQueryData(transactionQuery(data.id).queryKey, restored);
      await afterTransactionChange(queryClient, data.groupId, data.id);
      toast(`Restored ${what}`);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {friend ? (
        <Link
          to="/friends/$userId"
          params={{ userId: friend.id }}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← {friend.name}
        </Link>
      ) : (
        <Link
          to="/groups/$groupId"
          params={{ groupId: data.groupId }}
          search={{ tab: 'expenses' }}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          ← {groupTitle(group.data, meId)}
        </Link>
      )}

      <header className="flex flex-col gap-1">
        <h1 className={cn('text-2xl font-semibold tracking-tight', deleted && 'line-through')}>
          {title}
        </h1>
        <p className="text-3xl font-semibold tabular-nums">{money(data.amount)}</p>
        <p className="text-sm text-muted-foreground">
          {shortDate(data.occurredOn)} · last changed by {lastChange.name}
          {deleted && ' · deleted'}
        </p>
      </header>

      <p
        className={cn(
          'text-sm font-medium',
          // A payment moves money, it isn't a debt: neutral, as in the list.
          settlement
            ? 'text-muted-foreground'
            : data.myNet > 0
              ? 'text-owed'
              : data.myNet < 0
                ? 'text-owe'
                : 'text-muted-foreground',
        )}
      >
        {data.myNet > 0
          ? `${settlement ? 'You paid' : 'You lent'} ${money(data.myNet)}`
          : data.myNet < 0
            ? `${settlement ? 'You received' : 'You borrowed'} ${money(-data.myNet)}`
            : 'This doesn’t change your balance'}
      </p>

      {data.type === 'settlement' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Method</dt>
          <dd>{methodLabel(data.paymentMethod)}</dd>
          {data.paymentRef && (
            <>
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="break-all">{data.paymentRef}</dd>
            </>
          )}
        </dl>
      )}

      {data.notes && <p className="text-sm whitespace-pre-wrap">{data.notes}</p>}

      <div className="flex flex-wrap gap-2">
        {deleted ? (
          <Button loading={restoring} onClick={() => void restore()}>
            {!restoring && <RotateCcw aria-hidden />}
            Restore
          </Button>
        ) : (
          <>
            <Button asChild variant="outline">
              <Link
                to="/transactions/$id/edit"
                params={{ id: data.id }}
                onClick={() => markModal(`/transactions/${data.id}/edit`)}
              >
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </>
        )}
      </div>

      <section aria-labelledby="paid-heading" className="flex flex-col gap-2">
        <h2 id="paid-heading" className="text-sm font-semibold">
          {settlement ? 'From' : 'Paid by'}
        </h2>
        <LineList lines={data.payers} nameOf={nameOf} person={person} money={money} />
      </section>
      <section aria-labelledby="split-heading" className="flex flex-col gap-2">
        <h2 id="split-heading" className="text-sm font-semibold">
          {data.type === 'settlement' ? 'To' : SPLIT_HEADING[data.splitMethod]}
        </h2>
        <LineList
          lines={data.shares}
          nameOf={nameOf}
          person={person}
          money={money}
          input={data.type === 'expense' ? inputOf(data.splitInput) : undefined}
        />
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h2 id="history-heading" className="text-sm font-semibold">
          History
        </h2>
        {history.data ? (
          <ol className="flex flex-col gap-2 text-sm">
            {history.data.items.map((entry) => (
              <li key={entry.id} className="flex flex-col">
                <span>{describeEntry(entry, (u) => (u === meId ? 'you' : nameOf(u)), money)}</span>
                <span className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(entry.createdAt))}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </section>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${what}?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await api.deleteTransaction(data.id, data.version);
          await afterTransactionChange(queryClient, data.groupId, data.id);
          toast(`Deleted ${what}`, {
            action: {
              label: 'Undo',
              run: () =>
                void api
                  .restoreTransaction(data.id, result.version)
                  .then(() => afterTransactionChange(queryClient, data.groupId, data.id))
                  .catch((error: unknown) => toast(errorMessage(error), { tone: 'error' })),
            },
          });
          await navigate({
            to: '/groups/$groupId',
            params: { groupId: data.groupId },
            search: { tab: 'expenses' },
          });
        }}
      >
        It stops counting in everyone’s balances. You can undo this or restore it later.
      </ConfirmDialog>
      <Outlet />
    </div>
  );
}

const SPLIT_HEADING = {
  equal: 'Split equally',
  exact: 'Split by exact amounts',
  percent: 'Split by percentages',
  shares: 'Split by shares',
} as const;

/** What was typed for each person, shown beside their share: "40%", "2 shares". */
function inputOf(split: SplitInput | null): ((userId: string) => string | null) | undefined {
  if (split?.method === 'percent') {
    return (userId) => {
      const bp = split.basisPoints.find((p) => p.userId === userId)?.bp;
      return bp === undefined ? null : `${percentText(bp)}%`;
    };
  }
  if (split?.method === 'shares') {
    return (userId) => {
      const n = split.shares.find((s) => s.userId === userId)?.shares;
      return n === undefined ? null : `${n} ${n === 1 ? 'share' : 'shares'}`;
    };
  }
  return undefined;
}

function LineList({
  lines,
  nameOf,
  person,
  money,
  input,
}: {
  lines: { userId: string; amount: number }[];
  nameOf: (userId: string) => string;
  person: (
    userId: string,
  ) => { name: string; avatarUrl: string | null; isDeleted: boolean } | undefined;
  money: (amount: number) => string;
  /** Blueprint 7.2: the "input" view for percent and shares, such as "40% · ₹960". */
  input?: (userId: string) => string | null;
}) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {lines.map((line) => {
        const p = person(line.userId);
        return (
          <li key={line.userId} className="flex items-center gap-3 p-3">
            <Avatar
              name={p?.name ?? '?'}
              src={p?.avatarUrl}
              seed={line.userId}
              deleted={p?.isDeleted}
              size={36}
            />
            <span className="flex-1 text-sm">{nameOf(line.userId)}</span>
            <span className="text-sm tabular-nums">
              {input?.(line.userId) && (
                <span className="text-muted-foreground">{input(line.userId)} · </span>
              )}
              {money(line.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
