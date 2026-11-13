import type { Friend, Home as HomeData, Money } from '@fairshare/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, Link2, Plus, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { ErrorState } from '../../components/common/error-state';
import { MoneyLabel } from '../../components/common/money-label';
import { Skeleton } from '../../components/common/skeleton';
import { GroupTile } from '../../components/common/tiles';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { PageLayout, PageTitle, titleActionClass } from '../../components/layout/page';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ListCard } from '../../components/ui/list-card';
import { ActivityRow } from '../../features/activity/activity-row';
import { describeActivity } from '../../features/activity/describe';
import { activityFeedQuery } from '../../features/activity/queries';
import { HomeEntry } from '../../features/ai/home-entry';
import { OverallCard } from '../../features/balances/overall-card';
import { homeQuery } from '../../features/balances/queries';
import { useGroupSummaries, type GroupSummary } from '../../features/balances/summaries';
import { ClaimsBanner } from '../../features/claims/claims-banner';
import { AddFriendDialog } from '../../features/friends/add-friend-dialog';
import { JoinWithLink } from '../../features/invites/join-with-link';
import { meQuery } from '../../features/profile/queries';
import { plural, useFormatMoney } from '../../lib/money';
import { groupWords, personWords, TONE_TEXT } from '../../lib/money-words';
import { cn } from '../../lib/utils';

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
});

/**
 * The Groups tab on phones (DESIGN_SPEC §5 m-groups) and Home on desktop (d-home), one page that
 * rearranges at `lg`: my overall position, the typed-entry bar, my groups (rows on phones, cards
 * on desktop) and, on desktop, who owes me and whom I owe, with recent activity beside it.
 */
function HomePage() {
  const me = useQuery(meQuery);
  const home = useQuery(homeQuery);
  const [addingFriend, setAddingFriend] = useState(false);
  const [joining, setJoining] = useState(false);
  const data = home.data;
  const empty = data && data.groups.length === 0 && data.people.length === 0;
  // "Add expense" (the top bar, the floating button, the n key) asks who it's with; not before
  // there's a group or a friend to pick.
  useRegisterAddExpense(null, { enabled: Boolean(data && !empty) });
  const error = me.error ?? home.error;

  const title = (
    <PageTitle
      action={
        <>
          <Link
            to="/groups/new"
            aria-label="Start a new group"
            className={cn(titleActionClass, 'lg:hidden')}
          >
            <Plus aria-hidden className="size-5" strokeWidth={1.9} />
          </Link>
          <Button asChild variant="secondary" className="hidden lg:inline-flex">
            <Link to="/groups/new">
              <Plus aria-hidden strokeWidth={1.9} />
              New group
            </Link>
          </Button>
        </>
      }
    >
      <span className="lg:hidden">Groups</span>
      <span className="hidden lg:inline">Home</span>
    </PageTitle>
  );

  // Cached data stays on screen if a refetch fails (Blueprint 7.2); only a first load shows this.
  if (error && !data) {
    return (
      <PageLayout>
        {title}
        <ErrorState
          error={error}
          onRetry={() => void Promise.all([me.refetch(), home.refetch()])}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout rail={data && !empty ? <RecentActivity /> : undefined}>
      {title}
      <ClaimsBanner />

      {!data ? (
        <HomeSkeleton />
      ) : empty ? (
        <EmptyHome onAddFriend={() => setAddingFriend(true)} />
      ) : (
        <>
          <OverallCard totals={data.totals} />
          {me.data && <HomeEntry home={data} me={me.data} />}
          <PeopleBalances people={data.people} />
          <Groups groups={data.groups} />
          <Link
            to="/groups/new"
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-bold text-primary outline-none hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary lg:hidden"
          >
            <Plus aria-hidden className="size-[18px]" strokeWidth={1.9} />
            Start a new group
          </Link>
          <Button variant="ghost" className="self-start" onClick={() => setJoining(true)}>
            <Link2 aria-hidden strokeWidth={1.9} />
            Have an invite link?
          </Button>
        </>
      )}

      <Dialog
        open={joining}
        onClose={() => setJoining(false)}
        title="Join with an invite link"
        description="Paste the link someone shared with you."
      >
        <JoinWithLink />
      </Dialog>
      <AddFriendDialog open={addingFriend} onClose={() => setAddingFriend(false)} />
    </PageLayout>
  );
}

/** My groups: rows in one card on phones, a grid of cards on desktop. */
function Groups({ groups }: { groups: HomeData['groups'] }) {
  const summaries = useGroupSummaries(groups.map((g) => g.group));
  return (
    <section aria-labelledby="groups-heading" className="flex flex-col gap-2.5 lg:mt-1.5 lg:gap-4">
      <h2 id="groups-heading" className="sr-only text-lg leading-6 font-extrabold lg:not-sr-only">
        Groups
      </h2>
      <ListCard
        inset="tile"
        className="lg:grid lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none lg:[&>li+li]:before:hidden"
      >
        {groups.map(({ group, myNet }) => (
          <li key={group.id}>
            <GroupItem
              id={group.id}
              name={group.name ?? ''}
              emoji={group.emoji}
              people={group.members.filter((m) => m.leftAt === null).length}
              myNet={myNet}
              summary={summaries.get(group.id)}
            />
          </li>
        ))}
      </ListCard>
    </section>
  );
}

function GroupItem({
  id,
  name,
  emoji,
  people,
  myNet,
  summary,
}: {
  id: string;
  name: string;
  emoji: string | null;
  people: number;
  myNet: Money[];
  summary: GroupSummary | undefined;
}) {
  const format = useFormatMoney();
  const hasExpenses = summary?.hasExpenses ?? true;
  const line = summary?.line;
  const nets = myNet.length > 0 ? myNet : [null];
  return (
    <Link
      to="/groups/$groupId"
      params={{ groupId: id }}
      className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3.5 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset lg:h-full lg:flex-col lg:flex-nowrap lg:gap-3 lg:rounded-xl lg:border lg:bg-card lg:p-[18px] lg:shadow-card lg:hover:bg-card lg:hover:shadow-pop"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none">
        <GroupTile emoji={emoji} name={name} seed={id} size={48} />
        <span className="flex min-w-0 flex-col">
          <span className="text-base leading-[21px] font-bold break-words">{name}</span>
          <span className="text-[13px] leading-[18px] text-muted-foreground">
            {plural(people, 'person', 'people')}
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        {nets.map((money) => {
          const { words, tone } = groupWords(money?.amount ?? 0, hasExpenses);
          return (
            <MoneyLabel
              key={money?.currency ?? 'zero'}
              words={words}
              amount={money && format(money)}
              tone={tone}
              size="card"
              className="lg:items-start lg:text-left"
            />
          );
        })}
      </span>
      {line && (
        <span className="basis-full pl-[60px] text-[13px] leading-[18px] text-muted-foreground lg:basis-auto lg:pl-0 lg:leading-5">
          {line.text}
          {line.amount && (
            <>
              {' '}
              <span className={cn('font-bold tabular-nums', TONE_TEXT[line.tone])}>
                {format(line.amount)}
              </span>
            </>
          )}
        </span>
      )}
    </Link>
  );
}

/**
 * Desktop: "You’re owed" and "You owe", the people with a balance (DESIGN_SPEC §5 d-home). Each
 * person's total across every group we share, as on their own page and the Friends tab.
 */
function PeopleBalances({ people }: { people: Friend[] }) {
  const owed = people.filter((p) => p.balances.some((b) => b.amount > 0));
  const owe = people.filter((p) => p.balances.some((b) => b.amount < 0));
  return (
    <div className="hidden gap-[18px] lg:grid lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))] lg:items-start">
      <PeopleColumn
        title="You’re owed"
        people={owed}
        sign={1}
        none="Nobody owes you anything right now."
      />
      <PeopleColumn title="You owe" people={owe} sign={-1} none="You don’t owe anyone." />
    </div>
  );
}

function PeopleColumn({
  title,
  people,
  sign,
  none,
}: {
  title: string;
  people: Friend[];
  sign: 1 | -1;
  none: string;
}) {
  const format = useFormatMoney();
  const id = sign > 0 ? 'owed-heading' : 'owe-heading';
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <h2 id={id} className="text-base leading-6 font-extrabold tracking-[-0.01em]">
        {title}
      </h2>
      {people.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground shadow-card">
          {none}
        </p>
      ) : (
        <ListCard inset="avatar">
          {people.map(({ user, balances }) => (
            <li key={user.id}>
              <Link
                to="/friends/$userId"
                params={{ userId: user.id }}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset"
              >
                <Avatar
                  name={user.name}
                  src={user.avatarUrl}
                  seed={user.id}
                  deleted={user.isDeleted}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] leading-5 font-bold break-words">{user.name}</span>
                  {(user.isPlaceholder || user.isDeleted) && (
                    <span className="text-[13px] leading-[18px] text-muted-foreground">
                      {user.isDeleted ? 'Account deleted' : 'Not joined'}
                    </span>
                  )}
                </span>
                <span className="flex flex-col gap-1">
                  {balances
                    .filter((b) => Math.sign(b.amount) === sign)
                    .map((money) => {
                      const { words, tone } = personWords(money.amount);
                      return (
                        <MoneyLabel
                          key={money.currency}
                          words={words}
                          amount={format(money)}
                          tone={tone}
                        />
                      );
                    })}
                </span>
              </Link>
            </li>
          ))}
        </ListCard>
      )}
    </section>
  );
}

/** Desktop rail: the newest few changes, with a way to the full feed (d-home). */
function RecentActivity() {
  const me = useQuery(meQuery);
  const feed = useInfiniteQuery(activityFeedQuery);
  const format = useFormatMoney();
  const page = feed.data?.pages[0];
  const now = new Date();
  return (
    <section
      aria-labelledby="recent-heading"
      className="flex flex-col rounded-xl border bg-card pt-3.5 pb-1.5 shadow-card"
    >
      <div className="flex items-center justify-between gap-2 px-4">
        <h2 id="recent-heading" className="text-base font-extrabold tracking-[-0.01em]">
          Recent activity
        </h2>
        <Link
          to="/activity"
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-bold text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-focus-ring"
        >
          View all
          <ChevronRight aria-hidden className="size-[18px]" strokeWidth={1.9} />
        </Link>
      </div>
      {!page || !me.data ? (
        <div className="flex flex-col gap-3 px-4 py-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : page.items.length === 0 ? (
        <p className="px-4 pt-1 pb-3 text-sm text-muted-foreground">
          Changes in your groups will appear here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {page.items.slice(0, 6).map((entry) => (
            <li key={entry.id}>
              <ActivityRow
                entry={entry}
                isNew={entry.unread}
                meId={me.data.id}
                now={now}
                line={describeActivity(entry, {
                  meId: me.data.id,
                  people: page.people,
                  money: (amount, currency) => format({ amount, currency }),
                })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Before any group or friend: the three ways to start (D6). */
function EmptyHome({ onAddFriend }: { onAddFriend: () => void }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-3">
      <StartCard icon={Users} title="Start a group">
        <p>A trip, a flat, a dinner: everyone in one place.</p>
        <Button asChild className="mt-auto">
          <Link to="/groups/new">Start a group</Link>
        </Button>
      </StartCard>
      <StartCard icon={UserPlus} title="Add a friend">
        <p>For expenses between the two of you.</p>
        <Button className="mt-auto" variant="secondary" onClick={onAddFriend}>
          Add a friend
        </Button>
      </StartCard>
      <StartCard icon={Link2} title="Have an invite link?">
        <JoinWithLink />
      </StartCard>
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
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 text-[15px] leading-[22px] text-muted-foreground shadow-card">
      <span className="inline-flex size-12 items-center justify-center rounded-[14px] bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-6" strokeWidth={1.9} />
      </span>
      <h2 className="text-lg leading-6 font-extrabold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <Skeleton className="h-[124px] w-full rounded-xl" />
      <Skeleton className="h-[50px] w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
