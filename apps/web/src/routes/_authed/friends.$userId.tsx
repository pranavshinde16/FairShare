import { ApiError } from '@fairshare/api-client';
import type { Money } from '@fairshare/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { friendQuery } from '../../features/balances/queries';
import { ExpensesTab } from '../../features/expenses/expenses-tab';
import type { HistoryFilters } from '../../features/expenses/filters';
import { useNewExpenseShortcut } from '../../features/expenses/use-new-expense-shortcut';
import { InviteButton } from '../../features/groups/invite-button';
import { groupQuery } from '../../features/groups/queries';
import { meQuery } from '../../features/profile/queries';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { useFormatMoney } from '../../lib/money';
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
  useNewExpenseShortcut(addExpense);
  const flash = useFlash(
    JSON.stringify(friend.data?.total ?? null),
    `${userId} ${friend.data ? 'loaded' : 'loading'}`,
  );

  if (friend.error instanceof ApiError && friend.error.status === 404) {
    return (
      <EmptyState icon={UserRound} title="Person not found">
        You don’t share a group with this person.
      </EmptyState>
    );
  }
  if (friend.error)
    return <ErrorState error={friend.error} onRetry={() => void friend.refetch()} />;
  if (!friend.data || !me.data) return <Skeleton className="h-64 w-full rounded-xl" />;

  const { user, total, breakdown } = friend.data;
  const firstName = user.name.split(' ')[0] ?? user.name;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{user.name}</h1>
          {user.isPlaceholder && <p className="text-sm text-muted-foreground">Not joined yet</p>}
          {user.isDeleted && (
            <p className="text-sm text-muted-foreground">
              Account deleted. You can still record what’s paid back.
            </p>
          )}
        </div>
        {user.isPlaceholder && directGroupId && (
          // Not on FairShare yet: a link aimed at them, so they can join and see what we share.
          <InviteButton
            variant="outline"
            groupId={directGroupId}
            groupName={`You & ${user.name}`}
            placeholder={{ id: user.id, name: user.name }}
          />
        )}
        {canAdd && (
          <Button className="hidden md:inline-flex" loading={open.isPending} onClick={addExpense}>
            <Plus aria-hidden />
            Add expense
          </Button>
        )}
      </header>

      <section
        key={flash.key}
        aria-labelledby="total-heading"
        className={cn('rounded-xl border p-4', flash.className)}
      >
        <h2 id="total-heading" className="text-sm font-medium text-muted-foreground">
          Overall
        </h2>
        <Total total={total} name={firstName} />
      </section>

      <section aria-labelledby="groups-heading" className="flex flex-col gap-3">
        <h2 id="groups-heading" className="text-lg font-semibold">
          By group
        </h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {breakdown.map((entry) => {
            const where = entry.kind === 'direct' ? 'Just the two of you' : entry.groupName;
            const row = (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{where}</span>
                <BalanceText
                  balances={entry.balance.amount === 0 ? [] : [entry.balance]}
                  kind="person"
                  className="text-right text-sm"
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
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 p-3 hover:bg-muted"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 p-3">{row}</div>
                )}
                {/* Settling happens one group at a time (C5), so each group has its own button. */}
                {entry.balance.amount !== 0 && (
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
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
        </ul>
        <p className="text-xs text-muted-foreground">
          In a group, this is what the group’s suggested payments say the two of you settle.
        </p>
      </section>

      <section aria-labelledby="between-heading" className="flex flex-col gap-3">
        <h2 id="between-heading" className="text-lg font-semibold">
          Between you two
        </h2>
        {directGroupId === null ? (
          <p className="text-sm text-muted-foreground">
            No expenses yet outside your groups. Add one with “Add expense”.
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

      {canAdd && (
        <Button
          size="lg"
          aria-label="Add expense"
          loading={open.isPending}
          className="fixed right-4 bottom-20 z-10 rounded-full shadow-lg md:hidden"
          onClick={addExpense}
        >
          <Plus aria-hidden />
          Expense
        </Button>
      )}
      <Outlet />
    </div>
  );
}

/** "Bilal owes you ₹950" / "You owe Bilal ₹950" / settled, one line per currency. */
function Total({ total, name }: { total: Money[]; name: string }) {
  const format = useFormatMoney();
  if (total.length === 0) {
    return <p className="mt-1 text-xl font-semibold">You’re settled up</p>;
  }
  return (
    <div className="mt-1 flex flex-col">
      {total.map((money) => (
        <p
          key={money.currency}
          className={cn(
            'text-xl font-semibold tabular-nums',
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
