import type { Home } from '@fairshare/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState, type LinkProps } from '@tanstack/react-router';
import {
  Activity,
  Bell,
  House,
  Plus,
  Receipt,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { unreadActivityQuery } from '../../features/activity/queries';
import { homeQuery } from '../../features/balances/queries';
import { useGroupSummaries } from '../../features/balances/summaries';
import { ExpenseTargetPicker } from '../../features/expenses/expense-target-picker';
import { useNewExpenseShortcut } from '../../features/expenses/use-new-expense-shortcut';
import { AddFriendDialog } from '../../features/friends/add-friend-dialog';
import { meQuery } from '../../features/profile/queries';
import { useFormatMoney } from '../../lib/money';
import { groupWords, personWords, TONE_TEXT } from '../../lib/money-words';
import { cn } from '../../lib/utils';
import { Avatar } from '../common/avatar';
import { Spinner } from '../common/spinner';
import { GroupTile } from '../common/tiles';
import { buttonVariants } from '../ui/button';
import { useAddExpenseAction } from './add-expense-action';
import { LogoMark } from '../common/logo';

/**
 * The signed-in layout (DESIGN_SPEC §2). Below `lg` (1024px): one column, a frosted bottom tab bar
 * (Groups · Friends · Activity · Account) and, on the pages that ask for it, the floating "Add
 * expense" button. From `lg`: a top bar (logo · Add expense · Activity · avatar), a sidebar with
 * the navigation and the groups and friends with their balances, and the main area.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const home = useQuery(homeQuery);
  const action = useAddExpenseAction();
  const [picking, setPicking] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);
  // The page's own "Add expense" (its group's form), else "Who is it with?".
  // Without the page's own action, the picker needs Home's groups and people first.
  const ready = Boolean(action?.run) || home.data !== undefined;
  const addExpense = () => {
    if (action?.run) action.run();
    else if (home.data) setPicking(true);
  };
  // The desktop shortcut (Blueprint 7.1): "n" does the same, on the pages that offer it.
  useNewExpenseShortcut(() => {
    if (action && !action.busy) addExpense();
  });

  return (
    <div className="min-h-dvh bg-background">
      <TopBar onAddExpense={addExpense} busy={action?.busy ?? false} ready={ready} />
      <div className="lg:flex">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-[264px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-card px-3 pt-5 pb-8 lg:flex">
          <nav aria-label="Main" className="flex flex-col gap-0.5">
            <SidebarLink to="/" icon={House} label="Home" exact />
            <SidebarLink to="/activity" icon={Activity} label="Activity" badge />
            <SidebarLink to="/settings" icon={UserRound} label="Account" />
          </nav>
          <SidebarGroups home={home.data} />
          <SidebarFriends home={home.data} onAdd={() => setAddingFriend(true)} />
        </aside>
        <main className="min-w-0 flex-1 px-4 pt-3 pb-[calc(10rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-7 lg:pb-14">
          {children}
        </main>
      </div>
      {action && (
        <button
          type="button"
          aria-label="Add expense"
          disabled={action.busy || !ready}
          onClick={addExpense}
          className="fixed right-4 bottom-[calc(94px+env(safe-area-inset-bottom))] z-20 inline-flex h-14 items-center gap-2 rounded-[18px] bg-primary px-5 text-[15px] font-bold text-primary-foreground shadow-fab outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-45 lg:hidden"
        >
          {action.busy ? (
            <Spinner className="size-5" />
          ) : (
            <Receipt aria-hidden className="size-5" strokeWidth={1.9} />
          )}
          Add expense
        </button>
      )}
      <TabBar />
      {home.data && (
        <ExpenseTargetPicker open={picking} onClose={() => setPicking(false)} home={home.data} />
      )}
      <AddFriendDialog open={addingFriend} onClose={() => setAddingFriend(false)} />
    </div>
  );
}

/** Focus ring shared by the shell's links and buttons. */
const focusRing =
  'outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary';

function TopBar({
  onAddExpense,
  busy,
  ready,
}: {
  onAddExpense: () => void;
  busy: boolean;
  ready: boolean;
}) {
  const me = useQuery(meQuery);
  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b bg-card px-6 lg:flex">
      <Link
        to="/"
        aria-label="FairShare home"
        className={cn('inline-flex items-center gap-2.5 rounded-md', focusRing)}
      >
        <LogoMark />
        <span className="text-[19px] font-extrabold tracking-[-0.02em]">FairShare</span>
      </Link>
      <span className="flex-1" />
      <button
        type="button"
        disabled={busy || !ready}
        onClick={onAddExpense}
        className={cn(buttonVariants({ size: 'default' }), 'rounded-md px-[18px]')}
      >
        {busy ? <Spinner /> : <Receipt aria-hidden strokeWidth={1.9} />}
        Add expense
      </button>
      <Link
        to="/activity"
        className={cn(
          'relative inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted',
          focusRing,
        )}
      >
        <Bell aria-hidden className="size-5" strokeWidth={1.9} />
        <span className="sr-only">Activity</span>
        <UnreadBadge className="absolute top-[5px] right-[3px]" />
      </Link>
      <Link to="/settings" aria-label="Account" className={cn('rounded-full', focusRing)}>
        {me.data ? (
          <Avatar name={me.data.name} src={me.data.avatarUrl} seed={me.data.id} size={40} />
        ) : (
          <span className="block size-10 rounded-full bg-muted" />
        )}
      </Link>
    </header>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  exact = false,
  badge = false,
}: {
  to: LinkProps['to'];
  icon: LucideIcon;
  label: string;
  exact?: boolean;
  badge?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className={cn('flex min-h-11 items-center gap-2.5 rounded-md px-3 text-[15px]', focusRing)}
      // Colours only in one state or the other: both at once, the muted text would win over the
      // accent's and fail contrast on it.
      inactiveProps={{ className: 'font-semibold text-foreground hover:bg-muted' }}
      activeProps={{ className: 'bg-accent font-bold text-accent-foreground' }}
    >
      <Icon aria-hidden className="size-5" strokeWidth={1.9} />
      {label}
      {badge && <UnreadBadge className="ml-auto" />}
    </Link>
  );
}

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-[18px] flex flex-col gap-0.5">
      <div className="mb-0.5 flex items-center justify-between pl-3">
        <h2 className="text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const sidebarRow = cn('flex min-h-[52px] items-center gap-2.5 rounded-md px-3 py-1.5', focusRing);
const sidebarAdd = cn(
  'inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground',
  focusRing,
);

/** A row's name and its balance line ("you’re owed ₹5,550.00", "no expenses yet"). */
function RowText({ name, line }: { name: string; line: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-semibold">{name}</span>
      <span className="text-xs font-semibold whitespace-nowrap tabular-nums">{line}</span>
    </span>
  );
}

function SidebarGroups({ home }: { home: Home | undefined }) {
  const format = useFormatMoney();
  const groups = home?.groups ?? [];
  const summaries = useGroupSummaries(groups.map((g) => g.group));
  return (
    <SidebarSection
      title="Groups"
      action={
        <Link to="/groups/new" aria-label="Start a new group" className={sidebarAdd}>
          <Plus aria-hidden className="size-5" strokeWidth={1.9} />
        </Link>
      }
    >
      {home && groups.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">No groups yet.</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {groups.map(({ group, myNet }) => {
          const hasExpenses = summaries.get(group.id)?.hasExpenses ?? true;
          const lines = myNet.length > 0 ? myNet : [null];
          return (
            <li key={group.id}>
              <Link
                to="/groups/$groupId"
                params={{ groupId: group.id }}
                className={sidebarRow}
                inactiveProps={{ className: 'hover:bg-muted' }}
                activeProps={{ className: 'bg-accent' }}
              >
                <GroupTile emoji={group.emoji} name={group.name ?? ''} seed={group.id} size={32} />
                <RowText
                  name={group.name ?? ''}
                  line={lines.map((money) => {
                    const { words, tone } = groupWords(money?.amount ?? 0, hasExpenses);
                    return (
                      <span
                        key={money?.currency ?? 'zero'}
                        className={cn('block', TONE_TEXT[tone])}
                      >
                        {words}
                        {money && ` ${format(money)}`}
                      </span>
                    );
                  })}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}

function SidebarFriends({ home, onAdd }: { home: Home | undefined; onAdd: () => void }) {
  const format = useFormatMoney();
  const people = home?.people ?? [];
  return (
    <SidebarSection
      title="Friends"
      action={
        <button type="button" aria-label="Add a friend" onClick={onAdd} className={sidebarAdd}>
          <Plus aria-hidden className="size-5" strokeWidth={1.9} />
        </button>
      }
    >
      {home && people.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">No friends yet.</p>
      )}
      <ul className="flex flex-col gap-0.5">
        {people.map(({ user, balances }) => {
          const lines = balances.length > 0 ? balances : [null];
          return (
            <li key={user.id}>
              <Link
                to="/friends/$userId"
                params={{ userId: user.id }}
                className={sidebarRow}
                inactiveProps={{ className: 'hover:bg-muted' }}
                activeProps={{ className: 'bg-accent' }}
              >
                <Avatar
                  name={user.name}
                  src={user.avatarUrl}
                  seed={user.id}
                  deleted={user.isDeleted}
                  size={32}
                />
                <RowText
                  name={user.name}
                  line={lines.map((money) => {
                    const { words, tone } = personWords(money?.amount ?? 0);
                    return (
                      <span
                        key={money?.currency ?? 'zero'}
                        className={cn('block', TONE_TEXT[tone])}
                      >
                        {words}
                        {money && ` ${format(money)}`}
                      </span>
                    );
                  })}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}

/**
 * How many changes others made since I last opened Activity. The number is for the eye; screen
 * readers hear "Activity (3 unread)" from text placed after the label, wherever the badge sits.
 */
function UnreadBadge({ className }: { className?: string }) {
  const unread = useQuery(unreadActivityQuery);
  const count = unread.data ?? 0;
  if (count === 0) return null;
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-[5px] text-[10px] leading-none font-extrabold text-primary-foreground tabular-nums',
          className,
        )}
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only"> ({count} unread)</span>
    </>
  );
}

/** Which tab a page belongs to: a group and its expenses are under Groups, a friend under Friends. */
function useCurrentTab(): 'groups' | 'friends' | 'activity' | 'account' | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname === '/' || pathname.startsWith('/groups') || pathname.startsWith('/transactions'))
    return 'groups';
  if (pathname.startsWith('/friends')) return 'friends';
  if (pathname.startsWith('/activity')) return 'activity';
  if (pathname.startsWith('/settings')) return 'account';
  return null;
}

function TabBar() {
  const me = useQuery(meQuery);
  const tab = useCurrentTab();
  const item = (active: boolean) =>
    cn(
      'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px]',
      focusRing,
      // The active tab is marked by its tinted pill and bold label. The label stays in the text
      // colour: over the frosted bar, whatever scrolls behind it (a primary button) can take the
      // primary colour below AA contrast at 11px.
      active ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground',
    );
  const pill = (active: boolean) =>
    cn(
      'flex h-[30px] w-[52px] items-center justify-center rounded-full',
      active && 'bg-accent text-accent-foreground',
    );
  const icon = 'size-5';
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(78px+env(safe-area-inset-bottom))] border-t bg-nav pb-[calc(8px+env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
    >
      <Link
        to="/"
        aria-current={tab === 'groups' ? 'page' : undefined}
        className={item(tab === 'groups')}
      >
        <span className={pill(tab === 'groups')}>
          <Users aria-hidden className={icon} strokeWidth={1.9} />
        </span>
        Groups
      </Link>
      <Link
        to="/friends"
        aria-current={tab === 'friends' ? 'page' : undefined}
        className={item(tab === 'friends')}
      >
        <span className={pill(tab === 'friends')}>
          <UserRound aria-hidden className={icon} strokeWidth={1.9} />
        </span>
        Friends
      </Link>
      <Link
        to="/activity"
        aria-current={tab === 'activity' ? 'page' : undefined}
        className={item(tab === 'activity')}
      >
        <span className={pill(tab === 'activity')}>
          <Activity aria-hidden className={icon} strokeWidth={1.9} />
        </span>
        Activity
        <UnreadBadge className="absolute top-1.5 left-[calc(50%+8px)]" />
      </Link>
      <Link
        to="/settings"
        aria-current={tab === 'account' ? 'page' : undefined}
        className={item(tab === 'account')}
      >
        <span className={pill(tab === 'account')}>
          {me.data ? (
            <Avatar name={me.data.name} src={me.data.avatarUrl} seed={me.data.id} size={24} />
          ) : (
            <span className="size-6 rounded-full bg-muted" />
          )}
        </span>
        Account
      </Link>
    </nav>
  );
}
