import type { Group, Transaction } from '@fairshare/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Receipt, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterTransactionChange } from '../../lib/invalidation';
import { useFormatMoney } from '../../lib/money';
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

  return (
    <div className="flex flex-col gap-4">
      <HistoryFiltersBar group={group} meId={meId} filters={filters} onChange={onFiltersChange} />

      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        filtering ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
            <p>Nothing matches.</p>
            <Button variant="outline" size="sm" onClick={() => onFiltersChange({})}>
              Clear filters
            </Button>
          </div>
        ) : (
          <EmptyState icon={Receipt} title="No expenses yet">
            Add the first one with “Add expense”.
          </EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-5">
          {byMonth(items).map(([month, rows]) => (
            <section key={month} aria-label={month} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {month}
              </h3>
              <ul className="flex flex-col divide-y rounded-xl border">
                {rows.map((tx) => (
                  <li key={tx.id}>
                    <Row tx={tx} meId={meId} nameOf={nameOf} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div ref={sentinel} />
          {list.hasNextPage && (
            <Button
              variant="outline"
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
  // A payment reads "Bilal paid you" with its method; an expense, its description and who paid.
  const title =
    tx.type === 'settlement'
      ? paymentSentence(tx.payers[0].userId, tx.shares[0].userId, meId, nameOf)
      : tx.description;
  const who =
    tx.type === 'settlement'
      ? `Payment · ${methodLabel(tx.paymentMethod)}`
      : tx.payers.length === 1
        ? `${nameOf(tx.payers[0]!.userId)} paid ${money(tx.amount)}`
        : `${tx.payers.length} people paid ${money(tx.amount)}`;
  const involved = [...tx.payers, ...tx.shares].some((l) => l.userId === meId);
  const effect =
    tx.type === 'settlement'
      ? {
          text:
            tx.myNet > 0
              ? `you paid ${money(tx.myNet)}`
              : tx.myNet < 0
                ? `you received ${money(-tx.myNet)}`
                : money(tx.amount),
          className: 'text-muted-foreground',
        }
      : tx.myNet > 0
        ? {
            text: `you lent ${money(tx.myNet)}`,
            className: 'text-owed',
          }
        : tx.myNet < 0
          ? { text: `you borrowed ${money(-tx.myNet)}`, className: 'text-owe' }
          : { text: involved ? 'even' : 'not involved', className: 'text-muted-foreground' };

  const content = (
    <>
      <span className="flex w-10 shrink-0 flex-col items-center text-muted-foreground">
        <span className="text-[10px] uppercase">
          {new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date)}
        </span>
        <span className="text-lg leading-none font-semibold">{d}</span>
      </span>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
      >
        {tx.type === 'settlement' ? (
          <ArrowLeftRight className="size-4" />
        ) : (
          <Receipt className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate font-medium', tx.deletedAt && 'line-through')}>{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {pending ? 'Saving…' : who}
          {tx.deletedAt && ' · deleted'}
        </span>
      </span>
      {/* A deleted one doesn't count, so it has no effect to show. */}
      {!tx.deletedAt && (
        <span className={cn('text-right text-sm', effect.className)}>{effect.text}</span>
      )}
    </>
  );
  const className = cn('flex min-h-16 items-center gap-3 p-3', pending && 'opacity-60');
  if (pending) return <div className={className}>{content}</div>;
  const link = (
    <Link
      to="/transactions/$id"
      params={{ id: tx.id }}
      className={cn(className, 'min-w-0 flex-1 hover:bg-muted')}
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
        variant="outline"
        size="sm"
        className="mr-3"
        loading={restoring}
        aria-label={`Restore ${tx.type === 'settlement' ? title : `‘${title}’`}`}
        onClick={() => void restore()}
      >
        {!restoring && <RotateCcw aria-hidden />}
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
