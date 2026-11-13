import { ApiError } from '@fairshare/api-client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { ArrowLeftRight, ChevronRight, Link2, ReceiptText, Settings, X } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import type { Group, GroupBalances } from '@fairshare/contracts';
import { Avatar } from '../../components/common/avatar';
import { MoneyLabel } from '../../components/common/money-label';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { BackLink, PageLayout } from '../../components/layout/page';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { segmentItem, segmentTrack } from '../../components/ui/segmented-control';
import { BalancesTab } from '../../features/balances/balances-tab';
import { balancesQuery } from '../../features/balances/queries';
import { breakdownLine } from '../../features/balances/summaries';
import { ExpensesTab } from '../../features/expenses/expenses-tab';
import { HistoryFilters } from '../../features/expenses/filters';
import { GroupSettingsDialog } from '../../features/groups/group-settings-dialog';
import { InviteButton } from '../../features/groups/invite-button';
import { MembersTab } from '../../features/groups/members-tab';
import { groupQuery } from '../../features/groups/queries';
import { groupTitle } from '../../features/groups/title';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { useMarkModalOpen } from '../../lib/modal-route';
import { plural, useFormatMoney } from '../../lib/money';
import { memberWords, TONE_TEXT } from '../../lib/money-words';
import { useFlash } from '../../lib/use-flash';
import { cn } from '../../lib/utils';

const TABS = ['expenses', 'balances', 'members'] as const;

const GroupSearch = HistoryFilters.extend({
  tab: z.enum(TABS).default('expenses').catch('expenses'),
  /** Set right after creating the group, to prompt sharing the invite. */
  created: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_authed/groups/$groupId')({
  validateSearch: GroupSearch,
  component: GroupPage,
});

function GroupPage() {
  const { groupId } = Route.useParams();
  const { tab, created, ...search } = Route.useSearch();
  const filters = HistoryFilters.parse(search);
  const me = useQuery(meQuery);
  const group = useQuery(groupQuery(groupId));
  const balances = useQuery(balancesQuery(groupId));
  const currencies = useQuery(currenciesQuery);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const markModal = useMarkModalOpen();
  const addExpense = () => {
    markModal(`/groups/${groupId}/expenses/new`);
    void navigate({ to: '/groups/$groupId/expenses/new', params: { groupId } });
  };

  // The shell's "Add expense" (top bar, floating button, the n key) opens this group's form.
  useRegisterAddExpense(addExpense);
  // The position line lights up when it changes; not when it first loads.
  const flash = useFlash(
    JSON.stringify(balances.data?.me.net ?? null),
    `${groupId} ${balances.data ? 'loaded' : 'loading'}`,
  );

  const back = <BackLink to="/">Groups</BackLink>;
  if (group.error instanceof ApiError && group.error.status === 404) {
    return (
      <PageLayout>
        {back}
        <EmptyState icon={ReceiptText} title="Group not found">
          <p>This group doesn’t exist, or you’re not a member of it.</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link to="/">Go to Groups</Link>
          </Button>
        </EmptyState>
      </PageLayout>
    );
  }
  if (group.error) {
    return (
      <PageLayout>
        {back}
        <ErrorState error={group.error} onRetry={() => void group.refetch()} />
      </PageLayout>
    );
  }
  if (!group.data || !me.data) {
    return (
      <PageLayout>
        {back}
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-14 rounded-[17px] lg:size-16" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-[50px] w-full rounded-[13px]" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </PageLayout>
    );
  }

  const data = group.data;
  const meId = me.data.id;
  const title = groupTitle(data, meId);
  const activeCount = data.members.filter((m) => m.leftAt === null).length;
  // The right rail on desktop (DESIGN_SPEC §5 d-group-*): my balance and everyone's on Expenses,
  // "Invite with a link" on Members, none on Balances (it's all balances already).
  const rail = tab === 'expenses' || (tab === 'members' && data.kind === 'group');
  const recordPayment = () => markModal(`/groups/${groupId}/settle`);

  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-3.5 lg:mx-0',
        rail
          ? 'max-w-[1120px] lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-7 lg:gap-y-[18px]'
          : tab === 'balances'
            ? 'max-w-[1120px] lg:gap-[18px]'
            : 'max-w-[760px] lg:gap-[18px]',
      )}
    >
      <header className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 lg:col-start-1 lg:flex lg:gap-3.5">
        {back}
        <div className="col-start-2 row-start-1 flex items-center gap-2 lg:order-last">
          {data.kind === 'group' && (
            <Button
              variant="plain"
              size="icon"
              className="rounded-full lg:border lg:bg-card"
              aria-label="Group settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings aria-hidden className="size-5" strokeWidth={1.9} />
            </Button>
          )}
          <Button asChild variant="secondary" className="hidden lg:inline-flex">
            <Link
              to="/groups/$groupId/settle"
              params={{ groupId }}
              search={{ tab }}
              onClick={recordPayment}
            >
              <ArrowLeftRight aria-hidden strokeWidth={1.9} />
              Record a payment
            </Link>
          </Button>
          {/* Desktop: the group's own Add expense beside Record a payment (d-group-*). */}
          <Button className="hidden lg:inline-flex" onClick={addExpense}>
            <ReceiptText aria-hidden strokeWidth={1.9} />
            Add expense
          </Button>
        </div>
        <div className="col-span-2 flex min-w-0 items-center gap-3.5 lg:flex-1">
          <GroupTile
            emoji={data.emoji}
            name={title}
            seed={data.id}
            size={56}
            className="lg:size-16 lg:rounded-[19px] lg:text-[32px]"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="text-[26px] leading-8 font-extrabold tracking-[-0.02em] break-words lg:text-[30px] lg:leading-9">
              {title}
            </h1>
            <p className="mt-0.5 text-sm leading-[21px] text-muted-foreground">
              {data.kind === 'direct' ? 'Friendship' : plural(activeCount, 'person', 'people')} ·{' '}
              {data.currency}
            </p>
          </div>
        </div>
      </header>

      {created && data.kind === 'group' && (
        <section
          aria-label="Group created"
          className="flex items-start gap-3 rounded-xl border border-primary/30 bg-accent p-4 lg:col-start-1"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-[15px] leading-[22px] font-semibold">
              Group created. Share the invite link so the others can join.
            </p>
            <InviteButton variant="default" groupId={data.id} groupName={title} />
          </div>
          <Button
            variant="plain"
            size="icon"
            className="-mt-2 -mr-2 rounded-full"
            aria-label="Dismiss"
            onClick={() =>
              void navigate({
                to: '/groups/$groupId',
                params: { groupId },
                search: { tab },
                replace: true,
              })
            }
          >
            <X aria-hidden className="size-5" strokeWidth={1.9} />
          </Button>
        </section>
      )}

      {rail && (
        <div
          className={cn(
            'flex flex-col gap-[18px] lg:sticky lg:top-[92px] lg:col-start-2 lg:row-span-4 lg:row-start-1',
            // On phones the Members tab has no balance card, so nothing of the rail shows.
            tab === 'members' && 'hidden lg:flex',
          )}
        >
          {tab === 'expenses' && balances.data && (
            <>
              <BalanceCard
                key={flash.key}
                balances={balances.data}
                group={data}
                className={flash.className}
              />
              <EveryoneMini balances={balances.data} group={data} meId={meId} />
            </>
          )}
          {tab === 'expenses' && !balances.data && (
            <Skeleton className="h-[92px] w-full rounded-xl" />
          )}
          {tab === 'members' && (
            <section
              aria-labelledby="invite-link-heading"
              className="hidden flex-col gap-3 rounded-xl border bg-card p-5 shadow-card lg:flex"
            >
              <h2
                id="invite-link-heading"
                className="flex items-center gap-2.5 text-base font-extrabold"
              >
                <span
                  aria-hidden
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-accent text-primary"
                >
                  <Link2 className="size-[18px]" strokeWidth={1.9} />
                </span>
                Invite with a link
              </h2>
              <p className="text-sm leading-5 text-muted-foreground">
                People can join later with an invite link, or claim their place by signing up with
                the email you enter.
              </p>
              <InviteButton
                variant="tint"
                groupId={data.id}
                groupName={title}
                label="Create invite link"
                icon={Link2}
                className="self-start"
              />
            </section>
          )}
        </div>
      )}

      <nav
        aria-label="Group sections"
        className={cn(
          segmentTrack,
          'lg:col-start-1 lg:w-[300px] lg:self-start lg:justify-self-start',
        )}
      >
        {TABS.map((name) => (
          <Link
            key={name}
            to="/groups/$groupId"
            params={{ groupId }}
            search={{ tab: name }}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(segmentItem(tab === name), 'capitalize')}
          >
            {name}
          </Link>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col lg:col-start-1">
        {tab === 'expenses' && (
          <ExpensesTab
            group={data}
            meId={meId}
            filters={filters}
            // Replace, not push: Back leaves the group instead of undoing each keystroke.
            onFiltersChange={(next) =>
              void navigate({
                to: '/groups/$groupId',
                params: { groupId },
                search: { tab: 'expenses', ...next },
                replace: true,
              })
            }
          />
        )}
        {tab === 'balances' && <BalancesTab group={data} meId={meId} />}
        {tab === 'members' && <MembersTab group={data} meId={meId} />}
      </div>

      <Outlet />

      {data.kind === 'group' && currencies.data && settingsOpen && (
        <GroupSettingsDialog
          open
          onClose={() => setSettingsOpen(false)}
          group={data}
          currencies={currencies.data.items}
        />
      )}
    </div>
  );
}

/**
 * "Your balance": my position in the group with who I settle with, linking to the Balances tab
 * (DESIGN_SPEC §5 m-group-expenses). Lights up briefly when it changes.
 */
function BalanceCard({
  balances,
  group,
  className,
}: {
  balances: GroupBalances;
  group: Group;
  className?: string;
}) {
  const format = useFormatMoney();
  const line = breakdownLine(balances, group);
  const net = balances.me.net;
  return (
    <Link
      to="/groups/$groupId"
      params={{ groupId: group.id }}
      search={{ tab: 'balances' }}
      className={cn(
        'flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-card outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-focus-ring lg:flex-col lg:items-stretch lg:p-4',
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] text-muted-foreground">Your balance</span>
        {net.length === 0 ? (
          <span className="text-xl leading-[26px] font-extrabold text-muted-foreground">
            You’re settled up
          </span>
        ) : (
          net.map((money) => (
            <span
              key={money.currency}
              className={cn(
                'text-xl leading-[26px] font-extrabold tabular-nums lg:text-2xl lg:leading-[30px] lg:tracking-[-0.02em]',
                money.amount > 0 ? 'text-owed' : 'text-owe',
              )}
            >
              {/* Desktop's narrow rail: the words over the amount. */}
              <span className="lg:block">{money.amount > 0 ? 'You’re owed' : 'You owe'}</span>{' '}
              {format(money)}
            </span>
          ))
        )}
        {line && (
          <span className="text-[13px] leading-[18px] text-muted-foreground">
            {line.text}
            {line.amount && (
              <>
                {' '}
                <b className={cn('tabular-nums', TONE_TEXT[line.tone])}>{format(line.amount)}</b>
              </>
            )}
          </span>
        )}
      </span>
      <span className="flex items-center gap-0.5 text-sm font-bold text-primary lg:hidden">
        Balances
        <ChevronRight aria-hidden className="size-[18px]" strokeWidth={1.9} />
      </span>
      <span className="hidden h-11 items-center self-start rounded-lg bg-accent px-4 text-sm font-bold text-accent-foreground lg:inline-flex">
        View balances
      </span>
    </Link>
  );
}

/** Desktop rail: everyone's net in the group's currency, as on the Balances tab. */
function EveryoneMini({
  balances,
  group,
  meId,
}: {
  balances: GroupBalances;
  group: Group;
  meId: string;
}) {
  const format = useFormatMoney();
  const entry = balances.balances.find((b) => b.currency === group.currency);
  if (!entry || entry.nets.length === 0) return null;
  const person = (userId: string) => group.members.find((m) => m.user.id === userId)?.user;
  return (
    <section
      aria-labelledby="everyone-mini-heading"
      className="hidden flex-col rounded-xl border bg-card pt-3.5 pb-1.5 shadow-card lg:flex"
    >
      <h2 id="everyone-mini-heading" className="px-4 pb-1 text-base font-extrabold">
        Everyone’s balance
      </h2>
      <ul className="flex flex-col">
        {entry.nets.map((line) => {
          const user = person(line.userId);
          const me = line.userId === meId;
          const { words, tone } = memberWords(line.amount, me);
          return (
            <li key={line.userId} className="flex items-center gap-3 px-4 py-2">
              <Avatar
                name={user?.name ?? '?'}
                src={user?.avatarUrl}
                seed={line.userId}
                deleted={user?.isDeleted}
                size={32}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {me ? 'You' : (user?.name ?? 'Someone')}
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
