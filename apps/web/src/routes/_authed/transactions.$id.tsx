import { ApiError } from '@fairshare/api-client';
import type { SplitInput } from '@fairshare/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { ArrowDownLeft, ArrowUpRight, Pencil, ReceiptText, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { ConfirmDialog } from '../../components/common/confirm-dialog';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { IconTile } from '../../components/common/tiles';
import { BackLink, PageLayout } from '../../components/layout/page';
import { Button } from '../../components/ui/button';
import { ListCard } from '../../components/ui/list-card';
import { changeLines, entryHeadline } from '../../features/expenses/history';
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
import { DESKTOP, useMediaQuery } from '../../lib/use-media-query';
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
  const desktop = useMediaQuery(DESKTOP);

  if (tx.error instanceof ApiError && tx.error.status === 404) {
    return (
      <PageLayout>
        <BackLink to="/">Groups</BackLink>
        <EmptyState icon={ReceiptText} title="Not found">
          <p>It doesn’t exist, or you’re not in its group.</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link to="/">Go to Groups</Link>
          </Button>
        </EmptyState>
      </PageLayout>
    );
  }
  if (tx.error) {
    return (
      <PageLayout>
        <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />
      </PageLayout>
    );
  }
  if (!tx.data || !me.data || !group.data || !currencies.data) {
    return (
      <PageLayout>
        <Skeleton className="h-6 w-28" />
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-14 rounded-[17px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
        <Skeleton className="h-[34px] w-44 rounded-full" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </PageLayout>
    );
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

  const back = friend
    ? { to: '/friends/$userId' as const, params: { userId: friend.id }, label: friend.name }
    : {
        to: '/groups/$groupId' as const,
        params: { groupId: data.groupId },
        label: groupTitle(group.data, meId),
      };
  const effect = data.myNet;
  // A payment received is money coming to you; an expense lent is money owed to you.
  const pillTone = effect === 0 ? 'neutral' : effect > 0 === !settlement ? 'owed' : 'owe';
  // An icon beside the words, so the colour is never the only cue: owed points in, owing out.
  const PillIcon = pillTone === 'owed' ? ArrowDownLeft : ArrowUpRight;

  // Rendered once: in the rail beside the expense on desktop, below the split on phones.
  const history_ = (className?: string) => (
    <section aria-labelledby="history-heading" className={cn('flex flex-col gap-2.5', className)}>
      <h2 id="history-heading" className="text-lg leading-6 font-extrabold lg:text-base">
        History
      </h2>
      {history.data ? (
        <ol className="flex flex-col">
          {history.data.items.map((entry, i) => {
            const lines =
              entry.verb === 'transaction.updated'
                ? changeLines(
                    entry.before,
                    entry.after,
                    (u) => (u === meId ? 'you' : nameOf(u)),
                    money,
                  )
                : [];
            const last = i === history.data.items.length - 1;
            return (
              <li key={entry.id} className="relative pb-4 pl-[26px]">
                <span
                  aria-hidden
                  className="absolute top-[5px] left-0 size-3 rounded-full bg-primary"
                />
                {!last && (
                  <span
                    aria-hidden
                    className="absolute top-[18px] -bottom-1 left-[5px] w-0.5 bg-border"
                  />
                )}
                <p className="text-[15px] leading-[21px] font-bold">{entryHeadline(entry)}</p>
                {lines.length > 0 && (
                  <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-[18px] text-sm leading-5 tabular-nums">
                    {lines.map((line, j) => (
                      <li key={j}>
                        {line.label}
                        {line.to !== undefined && (
                          <>
                            {' '}
                            {line.from !== undefined && (
                              <>
                                <span className="text-muted-foreground">{line.from}</span> →{' '}
                              </>
                            )}
                            <b>{line.to}</b>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(entry.createdAt))}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
    </section>
  );

  return (
    <PageLayout rail={desktop ? history_('rounded-xl border bg-card p-5 shadow-card') : undefined}>
      {friend ? (
        <BackLink to="/friends/$userId" params={{ userId: friend.id }}>
          {friend.name}
        </BackLink>
      ) : (
        <BackLink
          to="/groups/$groupId"
          params={{ groupId: data.groupId }}
          search={{ tab: 'expenses' }}
        >
          {back.label}
        </BackLink>
      )}
      {/* Desktop: where it sits, "Goa Trip / Hotel, 2 nights" (d-expense). */}
      <nav aria-label="Breadcrumb" className="hidden text-sm lg:block">
        <ol className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <li>
            {friend ? (
              <Link
                to="/friends/$userId"
                params={{ userId: friend.id }}
                className="font-semibold text-primary hover:underline"
              >
                {friend.name}
              </Link>
            ) : (
              <Link
                to="/groups/$groupId"
                params={{ groupId: data.groupId }}
                search={{ tab: 'expenses' }}
                className="font-semibold text-primary hover:underline"
              >
                {back.label}
              </Link>
            )}
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="truncate">
            {title}
          </li>
        </ol>
      </nav>

      {deleted && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted px-4 py-3"
        >
          <Trash2 aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.9} />
          <p className="min-w-0 flex-1 text-[15px] leading-[22px] font-semibold">
            Deleted · it doesn’t count in anyone’s balance.
          </p>
          <Button loading={restoring} onClick={() => void restore()}>
            {!restoring && <RotateCcw aria-hidden strokeWidth={1.9} />}
            Restore
          </Button>
        </div>
      )}

      {/* Desktop: the expense itself in a card (d-expense). */}
      <div className="flex flex-col gap-3.5 lg:rounded-xl lg:border lg:bg-card lg:p-5 lg:shadow-card">
        <header className="flex items-start gap-3.5">
          <IconTile
            kind={settlement ? 'payment' : 'expense'}
            className="size-14 rounded-[17px] [&_svg]:size-6"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1
              className={cn(
                'text-2xl leading-[30px] font-extrabold tracking-[-0.02em] break-words lg:text-[26px] lg:leading-8',
                deleted && 'text-muted-foreground line-through',
              )}
            >
              {title}
            </h1>
            <p className="mt-1 text-[34px] leading-10 font-extrabold tracking-[-0.03em] tabular-nums">
              {money(data.amount)}
            </p>
            <p className="mt-1 text-sm leading-[21px] text-muted-foreground">
              {longDate(data.occurredOn)} · last changed by {lastChange.name}
              {deleted && ' · deleted'}
            </p>
          </div>
        </header>

        <p
          className={cn(
            'mt-3.5 inline-flex h-[34px] items-center gap-1.5 self-start lg:mt-0 rounded-full px-3.5 text-[15px] font-bold tabular-nums',
            pillTone === 'owed'
              ? 'bg-owed-muted text-owed'
              : pillTone === 'owe'
                ? 'bg-owe-muted text-owe-muted-foreground'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {effect !== 0 && <PillIcon aria-hidden className="size-4 shrink-0" strokeWidth={1.9} />}
          {effect > 0
            ? `${settlement ? 'You paid' : 'You lent'} ${money(effect)}`
            : effect < 0
              ? `${settlement ? 'You received' : 'You borrowed'} ${money(-effect)}`
              : 'This doesn’t change your balance'}
        </p>

        {data.type === 'settlement' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3.5 text-[15px] shadow-card">
            <dt className="text-muted-foreground">Method</dt>
            <dd className="font-semibold">{methodLabel(data.paymentMethod)}</dd>
            {data.paymentRef && (
              <>
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-semibold break-all">{data.paymentRef}</dd>
              </>
            )}
          </dl>
        )}

        {data.notes && (
          <div className="mt-2.5 rounded-lg bg-muted px-3.5 py-3 text-[15px] leading-[21px]">
            <p className="mb-0.5 text-xs font-bold text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap">{data.notes}</p>
          </div>
        )}

        {!deleted && (
          <div className="mt-3 flex flex-wrap gap-2.5 lg:mt-0">
            <Button asChild variant="secondary">
              <Link
                to="/transactions/$id/edit"
                params={{ id: data.id }}
                onClick={() => markModal(`/transactions/${data.id}/edit`)}
              >
                <Pencil aria-hidden strokeWidth={1.9} />
                Edit
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden strokeWidth={1.9} />
              Delete
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-5">
        <section aria-labelledby="paid-heading" className="mt-1 flex flex-col gap-2.5 lg:mt-0">
          <h2 id="paid-heading" className="text-lg leading-6 font-extrabold lg:text-base">
            {settlement ? 'From' : 'Paid by'}
          </h2>
          <LineList lines={data.payers} nameOf={nameOf} person={person} money={money} />
        </section>
        <section aria-labelledby="split-heading" className="flex flex-col gap-2.5">
          <h2 id="split-heading" className="text-lg leading-6 font-extrabold lg:text-base">
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
      </div>

      {/* History: the right rail on desktop, below the split on phones. */}
      {!desktop && history_()}

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${what}?`}
        confirmLabel="Delete"
        destructive
        icon={Trash2}
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
    </PageLayout>
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
    <ListCard inset="avatar">
      {lines.map((line) => {
        const p = person(line.userId);
        const typed = input?.(line.userId);
        return (
          <li key={line.userId} className="flex min-h-14 items-center gap-3 px-3.5 py-3">
            <Avatar
              name={p?.name ?? '?'}
              src={p?.avatarUrl}
              seed={line.userId}
              deleted={p?.isDeleted}
            />
            <span className="min-w-0 flex-1 text-[15px] leading-5 font-bold break-words">
              {nameOf(line.userId)}
            </span>
            <span className="text-[15px] whitespace-nowrap tabular-nums">
              {typed && <span className="text-muted-foreground">{typed} · </span>}
              <b className="font-extrabold">{money(line.amount)}</b>
            </span>
          </li>
        );
      })}
    </ListCard>
  );
}

/** "7 Nov 2026" in the browser's language. */
function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(y!, m! - 1, d));
}
