import type { Group, Transaction } from '@fairshare/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Receipt, RotateCcw, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { MoneyLabel } from '../../components/common/money-label';
import { Skeleton } from '../../components/common/skeleton';
import { IconTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { CapsLabel, ListCard } from '../../components/ui/list-card';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterTransactionChange } from '../../lib/invalidation';
import { plural, useFormatMoney } from '../../lib/money';
import { transactionWords } from '../../lib/money-words';
import { toast } from '../../lib/toast';
import { cn } from '../../lib/utils';
import { methodLabel, paymentSentence } from '../settlements/payment';
import { isFiltering, type HistoryFilters } from './filters';
import { HistoryFiltersBar } from './history-filters';
import { transactionsQuery } from './queries';
import { useIsPending } from './use-create-expense';

/**
 * Blueprint 7.2 Expenses tab: newest first, grouped by month, a page at a time as you scroll, with
 * search and filter chips. The caller keeps the filters (the group page in its URL).
 */
export function ExpensesTab({
  group,
  meId,
  filters,
  onFiltersChange,
}: {
  group: Group;
  meId: string;
  filters: HistoryFilters;
  onFiltersChange: (filters: HistoryFilters) => void;
}) {
  const list = useInfiniteQuery(transactionsQuery(group.id, filters));
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) {
        void list.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [list]);

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtering = isFiltering(filters);
  const nameOf = (userId: string) =>
    userId === meId
      ? 'You'
      : (group.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone');

  // "1 result", "3 results" once a search or filter is on and every page is in (the server sends
  // no total, so a count only shows when it's the whole answer).
  const count =
    filtering && list.data && !list.hasNextPage ? plural(items.length, 'result', 'results') : null;

  return (
    <div className="flex flex-col gap-3">
      <HistoryFiltersBar group={group} meId={meId} filters={filters} onChange={onFiltersChange} />

      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="flex flex-col gap-2.5">
          <Skeleton className="mt-1 h-4 w-28" />
          <Skeleton className="h-[280px] w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        filtering ? (
          <EmptyState icon={SearchX} title="Nothing matches">
            <p>Try another word, or fewer filters.</p>
            <Button variant="secondary" className="mt-4" onClick={() => onFiltersChange({})}>
              Clear filters
            </Button>
          </EmptyState>
        ) : (
          <EmptyState icon={Receipt} title="No expenses yet">
            Add the first one with “Add expense”.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {count && (
            <p aria-live="polite" className="text-[13px] leading-5 text-muted-foreground">
              {count}
            </p>
          )}
          {byMonth(items).map(([month, rows]) => (
            <section key={month} aria-label={month} className="flex flex-col gap-2.5">
              <CapsLabel className="mt-1">{month}</CapsLabel>
              <ListCard inset="none">
                {rows.map((tx) => (
                  <li key={tx.id}>
                    <Row tx={tx} meId={meId} nameOf={nameOf} />
                  </li>
                ))}
              </ListCard>
            </section>
          ))}
          <div ref={sentinel} />
          {list.hasNextPage && (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One history row (DESIGN_SPEC §4 ExpenseRow): the date (month over day), a receipt or two-way
 * arrow tile, the title with who paid, and my effect in words and colour. Text wraps; amounts are
 * never cut. A payment reads "Bilal paid you · Payment · UPI". A deleted one (D8) is struck
 * through, says "deleted", shows no effect (it doesn't count) and offers Restore. One still being
 * saved is faded with "Saving…".
 */
function Row({
  tx,
  meId,
  nameOf,
}: {
  tx: Transaction;
  meId: string;
  nameOf: (userId: string) => string;
}) {
  const format = useFormatMoney();
  const pending = useIsPending(tx.id);
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState(false);
  async function restore() {
    setRestoring(true);
    try {
      await api.restoreTransaction(tx.id, tx.version);
      await afterTransactionChange(queryClient, tx.groupId, tx.id);
      toast(tx.type === 'settlement' ? 'Restored the payment' : `Restored ‘${tx.description}’`);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setRestoring(false);
    }
  }
  const money = (amount: number) => format({ amount, currency: tx.currency });
  const [y, m, d] = tx.occurredOn.split('-').map(Number);
  const date = new Date(y!, m! - 1, d);
  const payment = tx.type === 'settlement';
  // A payment reads "Bilal paid you" with its method; an expense, its description and who paid.
  const title = payment
    ? paymentSentence(tx.payers[0].userId, tx.shares[0].userId, meId, nameOf)
    : tx.description;
  const who = payment
    ? `Payment · ${methodLabel(tx.paymentMethod)}`
    : tx.payers.length === 1
      ? `${nameOf(tx.payers[0]!.userId)} paid ${money(tx.amount)}`
      : `${plural(tx.payers.length, 'person', 'people')} paid ${money(tx.amount)}`;
  const involved = [...tx.payers, ...tx.shares].some((l) => l.userId === meId);
  const { words, tone } = transactionWords(tx.myNet, payment ? 'payment' : 'expense', involved);
  const effectAmount =
    tx.myNet !== 0 ? money(Math.abs(tx.myNet)) : payment ? money(tx.amount) : null;

  const content = (
    <>
      <span className="flex w-[30px] shrink-0 flex-col items-center text-center">
        <span className="text-[11px] leading-4 font-bold tracking-[0.04em] text-muted-foreground uppercase">
          {new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}
        </span>
        <span className="text-[19px] leading-[22px] font-extrabold tabular-nums">{d}</span>
      </span>
      <IconTile kind={payment ? 'payment' : 'expense'} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'text-[15px] leading-5 font-bold break-words',
            tx.deletedAt && 'text-muted-foreground line-through',
          )}
        >
          {title}
        </span>
        <span className="text-[13px] leading-[18px] text-muted-foreground">
          {pending ? 'Saving…' : who}
          {tx.deletedAt && ' · deleted'}
        </span>
      </span>
      {/* A deleted one doesn't count, so it has no effect to show. */}
      {!tx.deletedAt && <MoneyLabel words={words} amount={effectAmount} tone={tone} />}
    </>
  );
  const className = cn('flex min-h-14 items-center gap-2.5 px-3.5 py-3', pending && 'opacity-60');
  if (pending) return <div className={className}>{content}</div>;
  const link = (
    <Link
      to="/transactions/$id"
      params={{ id: tx.id }}
      className={cn(
        className,
        'min-w-0 flex-1 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset',
      )}
    >
      {content}
    </Link>
  );
  if (!tx.deletedAt) return link;
  // "Show deleted" lists deleted ones with a way back (Blueprint 11, Phase 10).
  return (
    <div className="flex items-center">
      {link}
      <Button
        variant="tint"
        size="sm"
        className="mr-3"
        loading={restoring}
        aria-label={`Restore ${payment ? title : `‘${title}’`}`}
        onClick={() => void restore()}
      >
        {!restoring && <RotateCcw aria-hidden strokeWidth={1.9} />}
        Restore
      </Button>
    </div>
  );
}

/** Transactions grouped under "November 2026"-style headings, keeping their order. */
function byMonth(items: Transaction[]): [string, Transaction[]][] {
  const format = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const groups: [string, Transaction[]][] = [];
  for (const tx of items) {
    const [y, m] = tx.occurredOn.split('-').map(Number);
    const label = format.format(new Date(y!, m! - 1, 1));
    const last = groups.at(-1);
    if (last?.[0] === label) last[1].push(tx);
    else groups.push([label, [tx]]);
  }
  return groups;
}
