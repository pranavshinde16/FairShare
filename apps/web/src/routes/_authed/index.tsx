import type { Home as HomeData } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronDown, Link2, Plus, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { HomeEntry } from '../../features/ai/home-entry';
import { ClaimsBanner } from '../../features/claims/claims-banner';
import { homeQuery } from '../../features/balances/queries';
import { AddFriendDialog } from '../../features/friends/add-friend-dialog';
import { JoinWithLink } from '../../features/invites/join-with-link';
import { meQuery } from '../../features/profile/queries';
import { useFormatMoney } from '../../lib/money';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
});

function HomePage() {
  const me = useQuery(meQuery);
  const home = useQuery(homeQuery);
  const [addingFriend, setAddingFriend] = useState(false);
  const data = home.data;
  const empty = data && data.groups.length === 0 && data.people.length === 0;
  // "Add expense" (the top bar, the floating button, the n key) asks who it's with; not before
  // there's a group or a friend to pick.
  useRegisterAddExpense(null, { enabled: Boolean(data && !empty) });
  const error = me.error ?? home.error;
  // Cached data stays on screen if a refetch fails (Blueprint 7.2); only a first load shows this.
  if (error && !home.data) {
    return (
      <ErrorState error={error} onRetry={() => void Promise.all([me.refetch(), home.refetch()])} />
    );
  }

  const firstName = me.data?.name.split(' ')[0];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {firstName ? `Hi, ${firstName}` : <Skeleton className="h-8 w-40" />}
          </h1>
          {data && !empty && <Totals totals={data.totals} />}
        </div>
      </header>
      <ClaimsBanner />
      {data && !empty && me.data && <HomeEntry home={data} me={me.data} />}

      {!data && <ListSkeleton />}

      {empty && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StartCard icon={Users} title="Start a group">
            <p>A trip, a flat, a dinner: everyone in one place.</p>
            <Button asChild className="mt-auto">
              <Link to="/groups/new">Start a group</Link>
            </Button>
          </StartCard>
          <StartCard icon={UserPlus} title="Add a friend">
            <p>For expenses between the two of you.</p>
            <Button className="mt-auto" variant="outline" onClick={() => setAddingFriend(true)}>
              Add a friend
            </Button>
          </StartCard>
          <StartCard icon={Link2} title="Have an invite link?">
            <JoinWithLink />
          </StartCard>
        </div>
      )}

      {data && !empty && (
        <>
          <section aria-labelledby="groups-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 id="groups-heading" className="text-lg font-semibold">
                Groups
              </h2>
              <Button asChild size="sm" variant="outline">
                <Link to="/groups/new">
                  <Plus aria-hidden />
                  New group
                </Link>
              </Button>
            </div>
            {data.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              <SettledLast
                items={data.groups}
                settled={(g) => g.myNet.length === 0}
                keyOf={(g) => g.group.id}
                noun={['group', 'groups']}
                render={({ group, myNet }) => (
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: group.id }}
                    className="flex min-h-16 items-center gap-3 p-3 hover:bg-muted"
                  >
                    <GroupTile
                      emoji={group.emoji}
                      name={group.name ?? ''}
                      seed={group.id}
                      size={48}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{group.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.members.filter((m) => m.leftAt === null).length} people
                      </span>
                    </span>
                    <BalanceText balances={myNet} kind="group" className="text-right text-sm" />
                  </Link>
                )}
              />
            )}
          </section>

          <section aria-labelledby="people-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 id="people-heading" className="text-lg font-semibold">
                People
              </h2>
              <Button size="sm" variant="outline" onClick={() => setAddingFriend(true)}>
                <UserPlus aria-hidden />
                Add a friend
              </Button>
            </div>
            {data.people.length === 0 ? (
              <p className="text-sm text-muted-foreground">No friends yet.</p>
            ) : (
              <SettledLast
                items={data.people}
                settled={(p) => p.balances.length === 0}
                keyOf={(p) => p.user.id}
                noun={['person', 'people']}
                render={(friend) => (
                  <Link
                    to="/friends/$userId"
                    params={{ userId: friend.user.id }}
                    className="flex min-h-16 items-center gap-3 p-3 hover:bg-muted"
                  >
                    <Avatar
                      name={friend.user.name}
                      src={friend.user.avatarUrl}
                      seed={friend.user.id}
                      deleted={friend.user.isDeleted}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{friend.user.name}</span>
                      {friend.user.isPlaceholder && (
                        <span className="text-xs text-muted-foreground">Not joined yet</span>
                      )}
                    </span>
                    <BalanceText
                      balances={friend.balances}
                      kind="person"
                      className="text-right text-sm"
                    />
                  </Link>
                )}
              />
            )}
          </section>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Have an invite link?</summary>
            <div className="mt-3 max-w-md">
              <JoinWithLink />
            </div>
          </details>
        </>
      )}

      <AddFriendDialog open={addingFriend} onClose={() => setAddingFriend(false)} />
    </div>
  );
}

/** "You’re owed ₹4,250 · You owe ₹800", one line per currency (Blueprint 7.2 TotalsHeader). */
function Totals({ totals }: { totals: HomeData['totals'] }) {
  const format = useFormatMoney();
  if (totals.length === 0) {
    return <p className="text-sm text-muted-foreground">You’re all settled up</p>;
  }
  return (
    <div className="flex flex-col text-sm">
      {totals.map(({ currency, owed, owe }) => (
        <p key={currency}>
          {owed > 0 && (
            <span className="text-owed">You’re owed {format({ amount: owed, currency })}</span>
          )}
          {owed > 0 && owe > 0 && <span className="text-muted-foreground"> · </span>}
          {owe > 0 && <span className="text-owe">You owe {format({ amount: owe, currency })}</span>}
        </p>
      ))}
    </div>
  );
}

/**
 * Rows with a balance first; settled ones folded away behind a button, unless everything is
 * settled (then there's nothing to put first).
 */
function SettledLast<T>({
  items,
  settled,
  keyOf,
  noun,
  render,
}: {
  items: T[];
  settled: (item: T) => boolean;
  keyOf: (item: T) => string;
  noun: [string, string];
  render: (item: T) => ReactNode;
}) {
  const [showSettled, setShowSettled] = useState(false);
  const open = items.filter((item) => !settled(item));
  const done = items.filter(settled);
  const fold = open.length > 0 && done.length > 0;
  const shown = fold && !showSettled ? open : [...open, ...done];
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y rounded-xl border">
        {shown.map((item) => (
          <li key={keyOf(item)}>{render(item)}</li>
        ))}
      </ul>
      {fold && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          aria-expanded={showSettled}
          onClick={() => setShowSettled((v) => !v)}
        >
          <ChevronDown
            aria-hidden
            className={cn('transition-transform', showSettled && 'rotate-180')}
          />
          {showSettled
            ? 'Hide settled'
            : `${done.length} settled ${done.length === 1 ? noun[0] : noun[1]}`}
        </Button>
      )}
    </div>
  );
}

function StartCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-5 text-sm text-muted-foreground">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}
