import { useQuery } from '@tanstack/react-query';
import { Link, type LinkProps } from '@tanstack/react-router';
import { Activity, House, Plus, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { homeQuery } from '../../features/balances/queries';
import { meQuery } from '../../features/profile/queries';
import { Avatar } from '../common/avatar';
import { Logo } from '../common/logo';
import { Skeleton } from '../common/skeleton';

const NAV: { to: LinkProps['to']; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/activity', label: 'Activity', icon: Activity },
];

/**
 * The signed-in layout (Blueprint 7.1). Below 768px: a header, one column and a bottom tab bar.
 * From 768px: a sidebar with navigation, groups and people, and the main column.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <Sidebar />
      <MobileHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-10">
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-6 overflow-y-auto border-r bg-card p-4 md:flex">
      <Link to="/" className="px-2 pt-1" aria-label="FairShare home">
        <Logo />
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            activeOptions={{ exact: to === '/' }}
            className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            activeProps={{ className: 'bg-accent text-accent-foreground hover:bg-accent' }}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        ))}
      </nav>
      <SidebarGroups />
      <SidebarPeople />
      <div className="mt-auto">
        <AccountLink />
      </div>
    </aside>
  );
}

const sidebarLink =
  'flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground';

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-h-0 flex-col gap-1">
      <h2 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SidebarGroups() {
  const home = useQuery(homeQuery);
  return (
    <SidebarSection title="Groups">
      {home.data?.groups.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">No groups yet.</p>
      )}
      <ul className="flex flex-col">
        {home.data?.groups.map(({ group }) => (
          <li key={group.id}>
            <Link
              to="/groups/$groupId"
              params={{ groupId: group.id }}
              className={sidebarLink}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
            >
              <span aria-hidden className="w-5 text-center">
                {group.emoji ?? '•'}
              </span>
              <span className="truncate">{group.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/groups/new" className={sidebarLink}>
        <Plus aria-hidden className="size-4" />
        New group
      </Link>
    </SidebarSection>
  );
}

function SidebarPeople() {
  const home = useQuery(homeQuery);
  return (
    <SidebarSection title="People">
      {home.data?.people.length === 0 && (
        <p className="px-3 text-sm text-muted-foreground">No friends yet.</p>
      )}
      <ul className="flex flex-col">
        {home.data?.people.map(({ user }) => (
          <li key={user.id}>
            <Link
              to="/friends/$userId"
              params={{ userId: user.id }}
              className={sidebarLink}
              activeProps={{ className: 'bg-accent text-accent-foreground' }}
            >
              <Avatar
                name={user.name}
                src={user.avatarUrl}
                size="sm"
                className="size-6 text-[10px]"
              />
              <span className="truncate">{user.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SidebarSection>
  );
}

/** The signed-in person, linking to settings. */
function AccountLink() {
  const me = useQuery(meQuery);
  return (
    <Link
      to="/settings"
      className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted"
      activeProps={{ className: 'bg-muted' }}
    >
      {me.data ? (
        <>
          <Avatar name={me.data.name} src={me.data.avatarUrl} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{me.data.name}</span>
            <span className="truncate text-xs text-muted-foreground">Settings</span>
          </span>
        </>
      ) : (
        <>
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </>
      )}
    </Link>
  );
}

function MobileHeader() {
  const me = useQuery(meQuery);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
      <Link to="/" aria-label="FairShare home">
        <Logo />
      </Link>
      <Link to="/settings" aria-label="Settings" className="rounded-full p-1">
        {me.data ? (
          <Avatar name={me.data.name} src={me.data.avatarUrl} size="sm" />
        ) : (
          <Skeleton className="size-8 rounded-full" />
        )}
      </Link>
    </header>
  );
}

function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <Link
          key={label}
          to={to}
          activeOptions={{ exact: to === '/' }}
          className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
          activeProps={{ className: 'text-primary' }}
        >
          <Icon aria-hidden className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
