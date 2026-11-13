import type { ActivityFeed } from '@fairshare/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { PageLayout, PageTitle } from '../../components/layout/page';
import { Button } from '../../components/ui/button';
import { CapsLabel, ListCard } from '../../components/ui/list-card';
import { ActivityRow, dayLabel } from '../../features/activity/activity-row';
import { describeActivity } from '../../features/activity/describe';
import { activityFeedQuery, unreadActivityQuery } from '../../features/activity/queries';
import { meQuery } from '../../features/profile/queries';
import { api } from '../../lib/api';
import { useFormatMoney } from '../../lib/money';

/**
 * Blueprint 7.2 Activity: changes across my groups, newest first, each as a sentence with my
 * effect, under day headings (DESIGN_SPEC §5 m-activity). Changes that involve me are semibold. Being here marks everything read: what was new
 * stays marked "New" for this visit, and is plain the next time.
 */
export const Route = createFileRoute('/_authed/activity')({
  component: ActivityPage,
});

function ActivityPage() {
  const me = useQuery(meQuery);
  const feed = useInfiniteQuery(activityFeedQuery);
  const unread = useQuery(unreadActivityQuery);
  // Entries that were unread at some point during this visit. Marking them seen updates the cached
  // feed at once, so this keeps them marked "New" until the person leaves the page.
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());
  const addFresh = useCallback(
    (ids: number[]) =>
      setFresh((old) => (ids.every((id) => old.has(id)) ? old : new Set([...old, ...ids]))),
    [],
  );
  useMarkSeen(Math.max(unread.data ?? 0, feed.data?.pages[0]?.unreadCount ?? 0), addFresh);
  const format = useFormatMoney();

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) {
        void feed.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [feed]);

  let body: ReactNode;
  if (feed.error) {
    body = <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  } else if (!feed.data || !me.data) {
    body = (
      <div className="flex flex-col gap-2.5">
        <Skeleton className="mt-1 h-4 w-16" />
        <Skeleton className="h-[340px] w-full rounded-xl" />
      </div>
    );
  } else if (feed.data.pages[0]?.items.length === 0) {
    body = (
      <EmptyState icon={Activity} title="Nothing here yet">
        When you or your friends add expenses, record payments or change a group, it shows here.
      </EmptyState>
    );
  } else {
    const meId = me.data.id;
    const now = new Date();
    // Entries under day headings ("Today", "Yesterday", "Wed, 12 Nov"), newest first.
    const days: { label: string; rows: ReactNode[] }[] = [];
    for (const page of feed.data.pages) {
      for (const entry of page.items) {
        const label = dayLabel(entry.createdAt, now);
        if (days.at(-1)?.label !== label) days.push({ label, rows: [] });
        days.at(-1)!.rows.push(
          <li key={entry.id}>
            <ActivityRow
              entry={entry}
              isNew={entry.unread || fresh.has(entry.id)}
              meId={meId}
              now={now}
              line={describeActivity(entry, {
                meId,
                people: page.people,
                money: (amount, currency) => format({ amount, currency }),
              })}
            />
          </li>,
        );
      }
    }
    body = (
      <>
        {days.map(({ label, rows }) => (
          <section key={label} aria-label={label} className="flex flex-col gap-2.5">
            <CapsLabel className="mt-1">{label}</CapsLabel>
            <ListCard inset="avatar">{rows}</ListCard>
          </section>
        ))}
        <div ref={sentinel} />
        {feed.hasNextPage && (
          <Button
            variant="secondary"
            loading={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </>
    );
  }

  return (
    <PageLayout>
      <PageTitle>Activity</PageTitle>
      {body}
    </PageLayout>
  );
}

/**
 * Marks the feed read whenever something unread is on record while the page is open: on arrival,
 * and again if the badge finds newer changes meanwhile. In order:
 *
 * 1. Fetch the feed, so the newest changes show, each saying whether it's unread; those are
 *    passed to `onNew`, to stay marked "New" for this visit.
 * 2. POST /activity/seen.
 * 3. Update the cached feed and badge to match, so coming back to the page shows them as read.
 */
function useMarkSeen(unread: number, onNew: (ids: number[]) => void) {
  const queryClient = useQueryClient();
  const sending = useRef(false);
  useEffect(() => {
    if (unread === 0 || sending.current) return;
    sending.current = true;
    void (async () => {
      try {
        await queryClient.refetchQueries({ queryKey: activityFeedQuery.queryKey, exact: true });
        const pages = queryClient.getQueryData(activityFeedQuery.queryKey)?.pages ?? [];
        onNew(pages.flatMap((page) => page.items.filter((e) => e.unread).map((e) => e.id)));
        await api.markActivitySeen();
        queryClient.setQueryData(activityFeedQuery.queryKey, (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  unreadCount: 0,
                  items: page.items.map((e) => (e.unread ? { ...e, unread: false } : e)),
                })),
              }
            : old,
        );
        queryClient.setQueryData<ActivityFeed>(unreadActivityQuery.queryKey, (old) =>
          old ? { ...old, unreadCount: 0 } : old,
        );
      } catch {
        // Not marking it read is harmless: the badge just stays until the next visit.
      } finally {
        sending.current = false;
      }
    })();
  }, [unread, queryClient, onNew]);
}
