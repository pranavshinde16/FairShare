import type { Group, GroupBalances, Money } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, ArrowRight, ChevronDown, Info, PartyPopper } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { useMarkModalOpen } from '../../lib/modal-route';
import { useFormatMoney } from '../../lib/money';
import { useFlash } from '../../lib/use-flash';
import { cn } from '../../lib/utils';
import { balancesQuery } from './queries';

const OWED = 'text-owed';
const OWES = 'text-owe';

/**
 * Blueprint 7.2 Balances tab, in the order 4.7 explains it: my position first, then the suggested
 * payments (each with "Settle"), then everyone's balance with what it's made of, so anyone can
 * check their own number.
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
    <div className="flex flex-col gap-6">
      <PositionCard net={data.me.net} groupId={group.id} />

      {data.balances.map((entry) => {
        const mine = (t: { from: string; to: string }) => t.from === meId || t.to === meId;
        const transfers = [
          ...entry.transfers.filter(mine),
          ...entry.transfers.filter((t) => !mine(t)),
        ];
        const breakdown = data.breakdown.filter((b) => b.paid.currency === entry.currency);
        return (
          <div key={entry.currency} className="flex flex-col gap-6">
            <section aria-labelledby={`payments-${entry.currency}`} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id={`payments-${entry.currency}`} className="text-lg font-semibold">
                  Suggested payments{several && ` (${entry.currency})`}
                </h2>
              </div>
              {transfers.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border p-4 text-sm">
                  <PartyPopper aria-hidden className="size-4 text-primary" />
                  {everyoneSettled ? 'All settled up' : `All settled up in ${entry.currency}`}
                </p>
              ) : (
                <ul className="flex flex-col divide-y rounded-xl border">
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
                        className={cn(
                          'flex min-h-14 items-center gap-3 p-3',
                          !mine(t) && 'text-muted-foreground',
                        )}
                      >
                        <span aria-hidden className="flex shrink-0 items-center gap-1">
                          <Avatar
                            name={from?.name ?? '?'}
                            src={from?.avatarUrl}
                            seed={t.from}
                            deleted={from?.isDeleted}
                            size={32}
                          />
                          <ArrowRight className="size-4" />
                          <Avatar
                            name={to?.name ?? '?'}
                            src={to?.avatarUrl}
                            seed={t.to}
                            deleted={to?.isDeleted}
                            size={32}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{words}</span>
                        <span className="text-sm font-medium tabular-nums">{amount}</span>
                        {/* Anyone can record any payment (Blueprint 4.8); mine stand out. */}
                        {entry.currency === group.currency && (
                          <Button
                            asChild
                            size="sm"
                            variant={mine(t) ? 'default' : 'outline'}
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
                </ul>
              )}
              <details className="text-sm text-muted-foreground">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2">
                  <Info aria-hidden className="size-4" />
                  How payments are suggested
                </summary>
                <p className="pb-2 pl-6">
                  Payments are simplified so the group settles with as few transfers as possible.
                  Your total is what matters; who pays whom may change as expenses are added.
                </p>
              </details>
            </section>

            {entry.currency === group.currency && (
              <Button asChild variant="outline" className="self-start">
                <Link
                  to="/groups/$groupId/settle"
                  params={{ groupId: group.id }}
                  search={{ tab: 'balances' }}
                  onClick={() => markModal(`/groups/${group.id}/settle`)}
                >
                  <ArrowLeftRight aria-hidden />
                  Record a payment
                </Link>
              </Button>
            )}

            <section aria-labelledby={`all-${entry.currency}`} className="flex flex-col gap-3">
              <h2 id={`all-${entry.currency}`} className="text-lg font-semibold">
                Everyone’s balance{several && ` (${entry.currency})`}
              </h2>
              <ul className="flex flex-col divide-y rounded-xl border">
                {entry.nets.map((line) => {
                  const user = person(line.userId);
                  const parts = breakdown.find((b) => b.userId === line.userId);
                  const net = { amount: line.amount, currency: entry.currency };
                  return (
                    <li key={line.userId}>
                      <details className="group">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3">
                          <Avatar
                            name={user?.name ?? '?'}
                            src={user?.avatarUrl}
                            seed={line.userId}
                            deleted={user?.isDeleted}
                            size={36}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {nameOf(line.userId)}
                          </span>
                          <MemberNet net={net} me={line.userId === meId} />
                          <ChevronDown
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                          />
                        </summary>
                        {parts && <Explanation parts={parts} />}
                      </details>
                    </li>
                  );
                })}
              </ul>
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
      className={cn('rounded-xl border p-4', flash.className)}
    >
      <h2 id="position-heading" className="text-sm font-medium text-muted-foreground">
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
    return <p className={cn('mt-1 text-xl font-semibold', className)}>You’re settled up</p>;
  }
  return (
    <div className={cn('mt-1 flex flex-col', className)}>
      {net.map((money) => (
        <p
          key={money.currency}
          className={cn('text-xl font-semibold tabular-nums', money.amount > 0 ? OWED : OWES)}
        >
          {money.amount > 0 ? `You’re owed ${format(money)}` : `You owe ${format(money)}`}
        </p>
      ))}
    </div>
  );
}

function MemberNet({ net, me }: { net: Money; me: boolean }) {
  const format = useFormatMoney();
  if (net.amount === 0) return <span className="text-sm text-muted-foreground">settled up</span>;
  const owed = net.amount > 0;
  const words = owed
    ? `${me ? 'get' : 'gets'} back ${format(net)}`
    : `${me ? 'owe' : 'owes'} ${format(net)}`;
  return <span className={cn('text-right text-sm', owed ? OWED : OWES)}>{words}</span>;
}

/** What a balance is made of: net = paid − share + sent − received. */
function Explanation({ parts }: { parts: GroupBalances['breakdown'][number] }) {
  const format = useFormatMoney();
  const items: [string, Money][] = [
    ['Paid for expenses', parts.paid],
    ['Share of expenses', parts.share],
  ];
  if (parts.sent.amount > 0) items.push(['Paid back', parts.sent]);
  if (parts.received.amount > 0) items.push(['Received back', parts.received]);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-3 pb-3 pl-14 text-sm text-muted-foreground">
      {items.map(([label, money]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd className="text-right tabular-nums">{format(money)}</dd>
        </div>
      ))}
    </dl>
  );
}

function BalancesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
