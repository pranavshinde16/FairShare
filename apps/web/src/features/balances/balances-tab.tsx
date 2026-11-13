import type { Group, GroupBalances, Money } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, ArrowRight, ChevronDown, CircleCheck, Info } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { ErrorState } from '../../components/common/error-state';
import { MoneyLabel } from '../../components/common/money-label';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { ListCard } from '../../components/ui/list-card';
import { useMarkModalOpen } from '../../lib/modal-route';
import { useFormatMoney } from '../../lib/money';
import { memberWords } from '../../lib/money-words';
import { useFlash } from '../../lib/use-flash';
import { cn } from '../../lib/utils';
import { balancesQuery } from './queries';

/**
 * The Balances tab (DESIGN_SPEC §5 m-group-balances, d-group-balances), in the order Blueprint 4.7
 * explains it: my position, then the suggested payments (each with "Settle"), how they're
 * suggested, then everyone's balance, each opening to what it's made of, so anyone can check their
 * own number. A group with money in another currency gets a section per currency (D19).
 */
export function BalancesTab({ group, meId }: { group: Group; meId: string }) {
  const balances = useQuery(balancesQuery(group.id));
  const format = useFormatMoney();
  const markModal = useMarkModalOpen();
  if (balances.error) {
    return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />;
  }
  if (!balances.data) return <BalancesSkeleton />;

  const data = balances.data;
  const person = (userId: string) => group.members.find((m) => m.user.id === userId)?.user;
  const nameOf = (userId: string) =>
    userId === meId ? 'You' : (person(userId)?.name ?? 'Someone');
  const several = data.balances.length > 1;
  const everyoneSettled = data.balances.every((entry) => entry.transfers.length === 0);

  return (
    <div className="flex flex-col gap-[18px]">
      <PositionCard net={data.me.net} groupId={group.id} />

      {data.balances.map((entry) => {
        const mine = (t: { from: string; to: string }) => t.from === meId || t.to === meId;
        const transfers = [
          ...entry.transfers.filter(mine),
          ...entry.transfers.filter((t) => !mine(t)),
        ];
        const breakdown = data.breakdown.filter((b) => b.paid.currency === entry.currency);
        const inCurrency = several ? ` (${entry.currency})` : '';
        return (
          <div key={entry.currency} className="flex flex-col gap-[18px]">
            <section
              aria-labelledby={`payments-${entry.currency}`}
              className="flex flex-col gap-2.5"
            >
              <h2
                id={`payments-${entry.currency}`}
                className="text-lg leading-6 font-extrabold lg:text-base"
              >
                Suggested payments{inCurrency}
              </h2>
              {transfers.length === 0 ? (
                <p className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3.5 text-[15px] font-semibold shadow-card">
                  <CircleCheck aria-hidden className="size-5 text-owed" strokeWidth={1.9} />
                  {everyoneSettled ? 'All settled up' : `All settled up in ${entry.currency}`}
                </p>
              ) : (
                <ListCard inset="none">
                  {transfers.map((t) => {
                    const from = person(t.from);
                    const to = person(t.to);
                    const words =
                      t.from === meId
                        ? `You pay ${nameOf(t.to)}`
                        : t.to === meId
                          ? `${nameOf(t.from)} pays you`
                          : `${nameOf(t.from)} pays ${nameOf(t.to)}`;
                    const amount = format({ amount: t.amount, currency: entry.currency });
                    return (
                      <li
                        key={`${t.from} ${t.to}`}
                        className="flex min-h-16 items-center gap-3 px-3.5 py-3"
                      >
                        <span aria-hidden className="flex shrink-0 items-center gap-1">
                          <Avatar
                            name={from?.name ?? '?'}
                            src={from?.avatarUrl}
                            seed={t.from}
                            deleted={from?.isDeleted}
                            size={32}
                          />
                          <ArrowRight className="size-4 text-muted-foreground" strokeWidth={1.9} />
                          <Avatar
                            name={to?.name ?? '?'}
                            src={to?.avatarUrl}
                            seed={t.to}
                            deleted={to?.isDeleted}
                            size={32}
                          />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-[15px] leading-5 font-semibold break-words">
                            {words}
                          </span>
                          <span className="text-[15px] leading-5 font-extrabold tabular-nums">
                            {amount}
                          </span>
                        </span>
                        {/* Anyone can record any payment (Blueprint 4.8); mine stand out. */}
                        {entry.currency === group.currency && (
                          <Button
                            asChild
                            size="sm"
                            variant={mine(t) ? 'default' : 'secondary'}
                            aria-label={`Settle: ${words} ${amount}`}
                          >
                            <Link
                              to="/groups/$groupId/settle"
                              params={{ groupId: group.id }}
                              search={{ tab: 'balances', from: t.from, to: t.to }}
                              onClick={() => markModal(`/groups/${group.id}/settle`)}
                            >
                              Settle
                            </Link>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ListCard>
              )}
              <div className="flex gap-2.5 rounded-lg bg-muted px-3.5 py-3 text-sm leading-5 text-muted-foreground">
                <Info aria-hidden className="mt-px size-[18px] shrink-0" strokeWidth={1.9} />
                <p>
                  <b className="font-bold text-foreground">How payments are suggested.</b> Payments
                  are simplified so the group settles with as few transfers as possible. Your total
                  is what matters; who pays whom may change as expenses are added.
                </p>
              </div>
            </section>

            {entry.currency === group.currency && (
              <Button asChild variant="secondary" className="self-start">
                <Link
                  to="/groups/$groupId/settle"
                  params={{ groupId: group.id }}
                  search={{ tab: 'balances' }}
                  onClick={() => markModal(`/groups/${group.id}/settle`)}
                >
                  <ArrowLeftRight aria-hidden strokeWidth={1.9} />
                  Record a payment
                </Link>
              </Button>
            )}

            <section aria-labelledby={`all-${entry.currency}`} className="flex flex-col gap-2.5">
              <h2
                id={`all-${entry.currency}`}
                className="text-lg leading-6 font-extrabold lg:text-base"
              >
                Everyone’s balance{inCurrency}
              </h2>
              <ListCard inset="none">
                {entry.nets.map((line) => {
                  const user = person(line.userId);
                  const parts = breakdown.find((b) => b.userId === line.userId);
                  const { words, tone } = memberWords(line.amount, line.userId === meId);
                  return (
                    <li key={line.userId}>
                      {/* BalanceRow (DESIGN_SPEC §4): opens to what the number is made of (D9). */}
                      <details className="group">
                        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-3.5 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                          <Avatar
                            name={user?.name ?? '?'}
                            src={user?.avatarUrl}
                            seed={line.userId}
                            deleted={user?.isDeleted}
                            size={36}
                          />
                          <span className="min-w-0 flex-1 text-[15px] leading-5 font-semibold break-words">
                            {nameOf(line.userId)}
                          </span>
                          <MoneyLabel
                            words={words}
                            amount={
                              line.amount === 0
                                ? null
                                : format({ amount: line.amount, currency: entry.currency })
                            }
                            tone={tone}
                          />
                          <ChevronDown
                            aria-hidden
                            className="size-[18px] shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                            strokeWidth={1.9}
                          />
                        </summary>
                        {parts && <Explanation parts={parts} />}
                      </details>
                    </li>
                  );
                })}
              </ListCard>
            </section>
          </div>
        );
      })}
    </div>
  );
}

/** "Your balance", lighting up briefly when it changes (after a payment, say). */
function PositionCard({ net, groupId }: { net: Money[]; groupId: string }) {
  const flash = useFlash(JSON.stringify(net), groupId);
  return (
    <section
      key={flash.key}
      aria-labelledby="position-heading"
      className={cn('rounded-xl border bg-card px-4 py-3.5 shadow-card', flash.className)}
    >
      <h2 id="position-heading" className="text-[13px] text-muted-foreground">
        Your balance
      </h2>
      <Position net={net} />
    </section>
  );
}

/** My net in words and colour, one line per currency. */
export function Position({ net, className }: { net: Money[]; className?: string }) {
  const format = useFormatMoney();
  if (net.length === 0) {
    return (
      <p className={cn('text-xl leading-[26px] font-extrabold', className)}>You’re settled up</p>
    );
  }
  return (
    <div className={cn('flex flex-col', className)}>
      {net.map((money) => (
        <p
          key={money.currency}
          className={cn(
            'text-xl leading-[26px] font-extrabold tabular-nums',
            money.amount > 0 ? 'text-owed' : 'text-owe',
          )}
        >
          {money.amount > 0 ? `You’re owed ${format(money)}` : `You owe ${format(money)}`}
        </p>
      ))}
    </div>
  );
}

/** What a balance is made of: net = paid − share + sent − received (D9). */
function Explanation({ parts }: { parts: GroupBalances['breakdown'][number] }) {
  const format = useFormatMoney();
  const items: [string, Money][] = [
    ['Paid for expenses', parts.paid],
    ['Share of expenses', parts.share],
  ];
  if (parts.sent.amount > 0) items.push(['Paid back', parts.sent]);
  if (parts.received.amount > 0) items.push(['Received back', parts.received]);
  return (
    <dl className="mx-3.5 mb-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-lg bg-muted px-3.5 py-3 text-sm text-muted-foreground">
      {items.map(([label, money]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd className="text-right font-semibold text-foreground tabular-nums">{format(money)}</dd>
        </div>
      ))}
    </dl>
  );
}

function BalancesSkeleton() {
  return (
    <div className="flex flex-col gap-[18px]">
      <Skeleton className="h-[78px] w-full rounded-xl" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
