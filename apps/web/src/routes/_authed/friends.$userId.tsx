import { ApiError } from '@fairshare/api-client';
import type { Money } from '@fairshare/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { MoneyLabel } from '../../components/common/money-label';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { BackLink, PageLayout } from '../../components/layout/page';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { ListCard } from '../../components/ui/list-card';
import { friendQuery, homeQuery } from '../../features/balances/queries';
import { ExpensesTab } from '../../features/expenses/expenses-tab';
import type { HistoryFilters } from '../../features/expenses/filters';
import { InviteButton } from '../../features/groups/invite-button';
import { groupQuery } from '../../features/groups/queries';
import { meQuery } from '../../features/profile/queries';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { useFormatMoney } from '../../lib/money';
import { personWords } from '../../lib/money-words';
import { toast } from '../../lib/toast';
import { useMarkModalOpen } from '../../lib/modal-route';
import { useFlash } from '../../lib/use-flash';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/_authed/friends/$userId')({
  component: FriendPage,
});

/**
 * Blueprint 4.3 friend detail: what we owe each other in total and in each group we share (so the
 * number can be explained), and the expenses between just the two of us.
 */
function FriendPage() {
  const { userId } = Route.useParams();
  const me = useQuery(meQuery);
  const friend = useQuery(friendQuery(userId));
  // Group tiles' emoji (the friend page names the groups only).
  const home = useQuery(homeQuery);
  const format = useFormatMoney();
  const directGroupId = friend.data?.directGroupId ?? null;
  const direct = useQuery({ ...groupQuery(directGroupId ?? ''), enabled: directGroupId !== null });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const markModal = useMarkModalOpen();
  const [filters, setFilters] = useState<HistoryFilters>({});

  // Expenses with a friend go in our friendship, which is opened on first use.
  const open = useMutation({
    mutationFn: async () => directGroupId ?? (await api.addFriend({ userId })).groupId,
    onSuccess: async (groupId) => {
      if (groupId !== directGroupId) await afterMembershipChange(queryClient, groupId);
      markModal(`/friends/${userId}/expenses/new`);
      await navigate({ to: '/friends/$userId/expenses/new', params: { userId } });
    },
    onError: (error) => toast(errorMessage(error), { tone: 'error' }),
  });
  // A deleted account can still be paid back (Settle up), but not put in new expenses.
  const canAdd = friend.data ? !friend.data.user.isDeleted : false;
  const addExpense = () => {
    if (canAdd && !open.isPending) open.mutate();
  };
  // The shell's "Add expense" (top bar, floating button, the n key) opens our friendship's form.
  useRegisterAddExpense(addExpense, { busy: open.isPending, enabled: canAdd });
  const flash = useFlash(
    JSON.stringify(friend.data?.total ?? null),
    `${userId} ${friend.data ? 'loaded' : 'loading'}`,
  );

  const back = <BackLink to="/friends">Friends</BackLink>;
  if (friend.error instanceof ApiError && friend.error.status === 404) {
    return (
      <PageLayout>
        {back}
        <EmptyState icon={UserRound} title="Person not found">
          <p>You don’t share a group with this person, so there’s nothing to show.</p>
          <Button asChild variant="secondary" className="mt-4">
            <Link to="/friends">Go to Friends</Link>
          </Button>
        </EmptyState>
      </PageLayout>
    );
  }
  if (friend.error) {
    return (
      <PageLayout>
        {back}
        <ErrorState error={friend.error} onRetry={() => void friend.refetch()} />
      </PageLayout>
    );
  }
  if (!friend.data || !me.data) {
    return (
      <PageLayout>
        {back}
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </PageLayout>
    );
  }

  const { user, total, breakdown } = friend.data;
  const firstName = user.name.split(' ')[0] ?? user.name;
  const tileOf = (groupId: string) => home.data?.groups.find((g) => g.group.id === groupId)?.group;

  return (
    // One page in a grid: on desktop the total moves to a column on the right (DESIGN_SPEC §2
    // right rail), without repeating it in the page.
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-7 lg:gap-y-[18px]">
      <div className="flex flex-col gap-3.5 lg:col-start-1">
        {back}
        <header className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
          <Avatar
            name={user.name}
            src={user.avatarUrl}
            seed={user.id}
            deleted={user.isDeleted}
            size={56}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="text-[26px] leading-8 font-extrabold tracking-[-0.02em] break-words lg:text-[30px] lg:leading-9">
              {user.name}
            </h1>
            {user.isPlaceholder && (
              <p className="text-sm leading-[21px] text-muted-foreground">Not joined yet</p>
            )}
            {user.isDeleted && (
              <p className="text-sm leading-[21px] text-muted-foreground">
                Account deleted. You can still record what’s paid back.
              </p>
            )}
          </div>
          {user.isPlaceholder && directGroupId && (
            // Not on FairShare yet: a link aimed at them, so they can join and see what we share.
            <InviteButton
              variant="tint"
              groupId={directGroupId}
              groupName={`You & ${user.name}`}
              placeholder={{ id: user.id, name: user.name }}
            />
          )}
        </header>
      </div>

      <section
        key={flash.key}
        aria-labelledby="total-heading"
        className={cn(
          'rounded-xl border bg-card p-4 shadow-card lg:sticky lg:top-[92px] lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:p-5',
          flash.className,
        )}
      >
        <h2 id="total-heading" className="text-sm font-semibold text-muted-foreground">
          Overall
        </h2>
        <Total total={total} name={firstName} />
      </section>

      <section aria-labelledby="groups-heading" className="flex flex-col gap-2.5 lg:col-start-1">
        <h2 id="groups-heading" className="text-lg leading-6 font-extrabold lg:text-base">
          By group
        </h2>
        <ListCard inset="avatar">
          {breakdown.map((entry) => {
            const where = entry.kind === 'direct' ? 'Just the two of you' : (entry.groupName ?? '');
            const tile = entry.kind === 'group' ? tileOf(entry.groupId) : undefined;
            const { words, tone } = personWords(entry.balance.amount);
            const row = (
              <>
                {entry.kind === 'direct' ? (
                  <Avatar
                    name={user.name}
                    src={user.avatarUrl}
                    seed={user.id}
                    deleted={user.isDeleted}
                  />
                ) : (
                  <GroupTile
                    emoji={tile?.emoji ?? null}
                    name={where}
                    seed={entry.groupId}
                    size={40}
                  />
                )}
                <span className="min-w-0 flex-1 text-[15px] leading-5 font-bold break-words">
                  {where}
                </span>
                <MoneyLabel
                  words={words}
                  amount={entry.balance.amount === 0 ? null : format(entry.balance)}
                  tone={tone}
                />
              </>
            );
            const key = `${entry.groupId} ${entry.balance.currency}`;
            return (
              <li key={key} className="flex items-center">
                {entry.kind === 'group' ? (
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: entry.groupId }}
                    search={{ tab: 'balances' }}
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 py-3">
                    {row}
                  </div>
                )}
                {/* Settling happens one group at a time (C5), so each group has its own button. */}
                {entry.balance.amount !== 0 && (
                  <Button
                    asChild
                    size="sm"
                    variant="tint"
                    className="mr-3"
                    aria-label={`Settle: ${where}`}
                  >
                    <Link
                      to="/friends/$userId/settle"
                      params={{ userId }}
                      search={{ groupId: entry.groupId }}
                      onClick={() => markModal(`/friends/${userId}/settle`)}
                    >
                      Settle
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ListCard>
        <p className="text-[13px] leading-5 text-muted-foreground">
          In a group, this is what the group’s suggested payments say the two of you settle.
        </p>
      </section>

      <section aria-labelledby="between-heading" className="flex flex-col gap-2.5 lg:col-start-1">
        <h2 id="between-heading" className="text-lg leading-6 font-extrabold lg:text-base">
          Between you two
        </h2>
        {directGroupId === null ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-[15px] leading-[22px] text-muted-foreground">
            No expenses yet outside your groups.
            {canAdd && ' Add one with “Add expense”.'}
          </p>
        ) : direct.data ? (
          <ExpensesTab
            group={direct.data}
            meId={me.data.id}
            filters={filters}
            onFiltersChange={setFilters}
          />
        ) : direct.error ? (
          <ErrorState error={direct.error} onRetry={() => void direct.refetch()} />
        ) : (
          <Skeleton className="h-32 w-full rounded-xl" />
        )}
      </section>

      <Outlet />
    </div>
  );
}

/** "Bilal owes you ₹950.00" / "You owe Bilal ₹950.00" / settled, one line per currency. */
function Total({ total, name }: { total: Money[]; name: string }) {
  const format = useFormatMoney();
  if (total.length === 0) {
    return (
      <p className="mt-1 text-[22px] leading-7 font-extrabold tracking-[-0.02em]">
        You’re settled up
      </p>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-1">
      {total.map((money) => (
        <p
          key={money.currency}
          className={cn(
            'text-[22px] leading-7 font-extrabold tracking-[-0.02em] tabular-nums',
            money.amount > 0 ? 'text-owed' : 'text-owe',
          )}
        >
          {money.amount > 0
            ? `${name} owes you ${format(money)}`
            : `You owe ${name} ${format(money)}`}
        </p>
      ))}
    </div>
  );
}
