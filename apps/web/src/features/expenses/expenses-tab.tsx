import type { Group, Transaction } from '@fairshare/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Receipt, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useFormatMoney } from '../../lib/money';
import { cn } from '../../lib/utils';
import { transactionsQuery } from './queries';
import { useIsPending } from './use-create-expense';

/** Blueprint 7.2 Expenses tab: newest first, grouped by month, a page at a time as you scroll. */
export function ExpensesTab({ group, meId }: { group: Group; meId: string }) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = { ...(q.length >= 2 && { q }), ...(includeDeleted && { includeDeleted }) };
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
  const filtering = Boolean(filters.q) || includeDeleted;
  const nameOf = (userId: string) =>
    userId === meId
      ? 'You'
      : (group.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search expenses"
            placeholder="Search"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => setIncludeDeleted(event.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          Show deleted
        </label>
      </div>

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
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>
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
  const money = (amount: number) => format({ amount, currency: tx.currency });
  const [y, m, d] = tx.occurredOn.split('-').map(Number);
  const date = new Date(y!, m! - 1, d);
  const who =
    tx.type === 'settlement'
      ? `${nameOf(tx.payers[0].userId)} paid ${nameOf(tx.shares[0].userId)}`
      : tx.payers.length === 1
        ? `${nameOf(tx.payers[0]!.userId)} paid ${money(tx.amount)}`
        : `${tx.payers.length} people paid ${money(tx.amount)}`;
  const involved = [...tx.payers, ...tx.shares].some((l) => l.userId === meId);
  const effect =
    tx.myNet > 0
      ? { text: `you lent ${money(tx.myNet)}`, className: 'text-emerald-700 dark:text-emerald-400' }
      : tx.myNet < 0
        ? { text: `you borrowed ${money(-tx.myNet)}`, className: 'text-destructive' }
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
        <span className={cn('truncate font-medium', tx.deletedAt && 'line-through')}>
          {tx.type === 'settlement' ? 'Settlement' : tx.description}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {pending ? 'Saving…' : who}
          {tx.deletedAt && ' · deleted'}
        </span>
      </span>
      <span className={cn('text-right text-sm', effect.className)}>{effect.text}</span>
    </>
  );
  const className = cn('flex min-h-16 items-center gap-3 p-3', pending && 'opacity-60');
  return pending ? (
    <div className={className}>{content}</div>
  ) : (
    <Link to="/transactions/$id" params={{ id: tx.id }} className={cn(className, 'hover:bg-muted')}>
      {content}
    </Link>
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
