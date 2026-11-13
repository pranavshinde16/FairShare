import type { Friend } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, UserPlus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { PageLayout, PageTitle, titleActionClass } from '../../components/layout/page';
import { Button } from '../../components/ui/button';
import { CapsLabel, ListCard } from '../../components/ui/list-card';
import { OverallCard } from '../../features/balances/overall-card';
import { homeQuery } from '../../features/balances/queries';
import { AddFriendDialog } from '../../features/friends/add-friend-dialog';

/**
 * The Friends tab (DESIGN_SPEC §5 m-friends, §6.1): everyone I share expenses with and what we owe
 * each other, those with a balance first and the settled ones below. From Home's data: each
 * person's total across every group we share, as on their own page.
 */
export const Route = createFileRoute('/_authed/friends/')({
  component: FriendsPage,
});

function FriendsPage() {
  const home = useQuery(homeQuery);
  const [adding, setAdding] = useState(false);
  // "Add expense" here asks who it's with.
  useRegisterAddExpense(null);

  const people = home.data?.people ?? [];
  const open = people.filter((p) => p.balances.length > 0);
  const settled = people.filter((p) => p.balances.length === 0);

  return (
    <PageLayout>
      <PageTitle
        action={
          <button
            type="button"
            aria-label="Add a friend"
            className={titleActionClass}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden className="size-5" strokeWidth={1.9} />
          </button>
        }
      >
        Friends
      </PageTitle>

      {home.error && !home.data ? (
        <ErrorState error={home.error} onRetry={() => void home.refetch()} />
      ) : !home.data ? (
        <div className="flex flex-col gap-3.5">
          <Skeleton className="h-[124px] w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : people.length === 0 ? (
        <EmptyState icon={UserRound} title="No friends yet">
          <p>Add a friend to split expenses between the two of you.</p>
          <Button className="mt-4" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden />
            Add a friend
          </Button>
        </EmptyState>
      ) : (
        <>
          <OverallCard totals={home.data.totals} />
          {open.length > 0 && <FriendList people={open} label="Friends with a balance" />}
          {settled.length > 0 && (
            <section aria-labelledby="settled-heading" className="mt-1 flex flex-col gap-2">
              <CapsLabel id="settled-heading">Settled up</CapsLabel>
              <FriendList people={settled} label="Settled up" />
            </section>
          )}
          <p className="text-[13px] leading-5 text-muted-foreground">
            A friend’s balance adds up what the two of you owe each other in every group you share
            and outside them.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-bold text-primary outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary"
          >
            <UserPlus aria-hidden className="size-[18px]" strokeWidth={1.9} />
            Add a friend
          </button>
        </>
      )}

      <AddFriendDialog open={adding} onClose={() => setAdding(false)} />
    </PageLayout>
  );
}

function FriendList({ people, label }: { people: Friend[]; label: string }) {
  return (
    <ListCard inset="person" aria-label={label}>
      {people.map(({ user, balances }) => (
        <li key={user.id}>
          <Link
            to="/friends/$userId"
            params={{ userId: user.id }}
            className="flex min-h-14 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset"
          >
            <Avatar
              name={user.name}
              src={user.avatarUrl}
              seed={user.id}
              deleted={user.isDeleted}
              size={44}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base leading-[21px] font-bold break-words">{user.name}</span>
              {(user.isPlaceholder || user.isDeleted) && (
                <span className="text-[13px] leading-[18px] text-muted-foreground">
                  {user.isDeleted ? 'Account deleted' : 'Not joined'}
                </span>
              )}
            </span>
            <BalanceText balances={balances} kind="person" layout="stacked" />
          </Link>
        </li>
      ))}
    </ListCard>
  );
}
