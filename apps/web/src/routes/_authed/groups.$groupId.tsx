import { ApiError } from '@fairshare/api-client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Plus, Receipt, Scale, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { ExpensesTab } from '../../features/expenses/expenses-tab';
import { GroupSettingsDialog } from '../../features/groups/group-settings-dialog';
import { InviteButton } from '../../features/groups/invite-button';
import { MembersTab } from '../../features/groups/members-tab';
import { groupQuery } from '../../features/groups/queries';
import { groupTitle } from '../../features/groups/title';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { cn } from '../../lib/utils';

const TABS = ['expenses', 'balances', 'members'] as const;

const GroupSearch = z.object({
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
  const { tab, created } = Route.useSearch();
  const me = useQuery(meQuery);
  const group = useQuery(groupQuery(groupId));
  const currencies = useQuery(currenciesQuery);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const addExpense = () =>
    void navigate({ to: '/groups/$groupId/expenses/new', params: { groupId } });

  // Desktop shortcut (Blueprint 7.1): "n" opens a new expense, unless someone is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target.closest('input, textarea, select, [contenteditable], dialog')) return;
      event.preventDefault();
      addExpense();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (group.error instanceof ApiError && group.error.status === 404) {
    return (
      <EmptyState icon={Receipt} title="Group not found">
        This group doesn’t exist or you’re not a member.
      </EmptyState>
    );
  }
  if (group.error) return <ErrorState error={group.error} onRetry={() => void group.refetch()} />;
  if (!group.data || !me.data) return <Skeleton className="h-64 w-full rounded-xl" />;

  const data = group.data;
  const title = groupTitle(data, me.data.id);
  const activeCount = data.members.filter((m) => m.leftAt === null).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-2xl"
        >
          {data.emoji ?? title.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.kind === 'direct' ? 'Friendship' : `${activeCount} people`} · {data.currency}
          </p>
        </div>
        <Button className="hidden md:inline-flex" onClick={addExpense}>
          <Plus aria-hidden />
          Add expense
        </Button>
        {data.kind === 'group' && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Group settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings aria-hidden />
          </Button>
        )}
      </header>

      {created && data.kind === 'group' && (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
          <p>Group created. Share the invite link so the others can join.</p>
          <InviteButton groupId={data.id} groupName={title} />
        </div>
      )}

      <nav aria-label="Group sections" className="grid grid-cols-3 rounded-lg bg-muted p-1">
        {TABS.map((name) => (
          <Link
            key={name}
            to="/groups/$groupId"
            params={{ groupId }}
            search={{ tab: name }}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center justify-center rounded-md text-sm font-medium capitalize',
              tab === name ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {name}
          </Link>
        ))}
      </nav>

      {tab === 'expenses' && <ExpensesTab group={data} meId={me.data.id} />}
      {tab === 'balances' && (
        <EmptyState icon={Scale} title="Nothing to settle">
          Balances appear here once the group has expenses.
        </EmptyState>
      )}
      {tab === 'members' && <MembersTab group={data} meId={me.data.id} />}

      {/* The floating "Add expense" button on phones, above the tab bar. */}
      <Button
        size="lg"
        aria-label="Add expense"
        className="fixed right-4 bottom-20 z-10 rounded-full shadow-lg md:hidden"
        onClick={addExpense}
      >
        <Plus aria-hidden />
        Expense
      </Button>
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
