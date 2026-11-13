import { ApiError } from '@fairshare/api-client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { Receipt, Settings } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { BalanceText } from '../../components/common/balance-text';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { useRegisterAddExpense } from '../../components/layout/add-expense-action';
import { BackLink } from '../../components/layout/page';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { segmentItem, segmentTrack } from '../../components/ui/segmented-control';
import { BalancesTab } from '../../features/balances/balances-tab';
import { balancesQuery } from '../../features/balances/queries';
import { ExpensesTab } from '../../features/expenses/expenses-tab';
import { HistoryFilters } from '../../features/expenses/filters';
import { GroupSettingsDialog } from '../../features/groups/group-settings-dialog';
import { InviteButton } from '../../features/groups/invite-button';
import { MembersTab } from '../../features/groups/members-tab';
import { groupQuery } from '../../features/groups/queries';
import { groupTitle } from '../../features/groups/title';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { useMarkModalOpen } from '../../lib/modal-route';
import { plural } from '../../lib/money';
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
      <BackLink to="/">Groups</BackLink>
      <header className="flex items-center gap-3">
        <GroupTile emoji={data.emoji} name={title} seed={data.id} size={56} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.kind === 'direct' ? 'Friendship' : plural(activeCount, 'person', 'people')} ·{' '}
            {data.currency}
          </p>
        </div>
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

      {/* My position stays in view above the tabs (Blueprint 7.2: pinned on phones). */}
      {tab !== 'balances' && balances.data && (
        <Link
          key={flash.key}
          to="/groups/$groupId"
          params={{ groupId }}
          search={{ tab: 'balances' }}
          className={cn(
            '-my-2 flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm hover:bg-muted',
            flash.className,
          )}
        >
          <BalanceText balances={balances.data.me.net} kind="group" className="font-medium" />
          <span className="text-primary">Balances</span>
        </Link>
      )}

      <nav aria-label="Group sections" className={segmentTrack}>
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

      {tab === 'expenses' && (
        <ExpensesTab
          group={data}
          meId={me.data.id}
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
      {tab === 'balances' && <BalancesTab group={data} meId={me.data.id} />}
      {tab === 'members' && <MembersTab group={data} meId={me.data.id} />}

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
