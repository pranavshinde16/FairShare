import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Link2, Plus, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { ClaimsBanner } from '../../features/claims/claims-banner';
import { AddFriendDialog } from '../../features/friends/add-friend-dialog';
import { friendsQuery, groupsQuery } from '../../features/groups/queries';
import { JoinWithLink } from '../../features/invites/join-with-link';
import { meQuery } from '../../features/profile/queries';

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
});

function HomePage() {
  const me = useQuery(meQuery);
  const groups = useQuery(groupsQuery);
  const friends = useQuery(friendsQuery);
  const [addingFriend, setAddingFriend] = useState(false);
  const error = me.error ?? groups.error ?? friends.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void Promise.all([me.refetch(), groups.refetch(), friends.refetch()])}
      />
    );
  }

  const firstName = me.data?.name.split(' ')[0];
  const loading = !groups.data || !friends.data;
  const empty = !loading && groups.data.items.length === 0 && friends.data.items.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {firstName ? `Hi, ${firstName}` : <Skeleton className="h-8 w-40" />}
      </h1>
      <ClaimsBanner />

      {loading && <ListSkeleton />}

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

      {!loading && !empty && (
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
            {groups.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {groups.data.items.map((group) => (
                  <li key={group.id}>
                    <Link
                      to="/groups/$groupId"
                      params={{ groupId: group.id }}
                      className="flex min-h-16 items-center gap-3 p-3 hover:bg-muted"
                    >
                      <span
                        aria-hidden
                        className="flex size-10 items-center justify-center rounded-lg bg-accent text-xl"
                      >
                        {group.emoji ?? group.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{group.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.members.filter((m) => m.leftAt === null).length} people
                        </span>
                      </span>
                      <BalanceText
                        balances={group.myNet}
                        kind="group"
                        className="text-right text-sm"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
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
            {friends.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No friends yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-xl border">
                {friends.data.items.map((friend) => {
                  const row = (
                    <>
                      <Avatar name={friend.user.name} src={friend.user.avatarUrl} />
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
                    </>
                  );
                  return (
                    <li key={friend.user.id}>
                      {friend.directGroupId ? (
                        <Link
                          to="/groups/$groupId"
                          params={{ groupId: friend.directGroupId }}
                          className="flex min-h-16 items-center gap-3 p-3 hover:bg-muted"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className="flex min-h-16 items-center gap-3 p-3">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
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
