import type { ActivityEntry, ActivityFeed } from '@fairshare/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { describeActivity, type ActivityLine } from '../../features/activity/describe';
import { activityFeedQuery, unreadActivityQuery } from '../../features/activity/queries';
import { meQuery } from '../../features/profile/queries';
import { api } from '../../lib/api';
import { useFormatMoney } from '../../lib/money';
import { relativeTime } from '../../lib/relative-time';
import { cn } from '../../lib/utils';

/**
 * Blueprint 7.2 Activity: changes across my groups, newest first, each as a sentence with my
 * effect; changes that involve me stand out. Being here marks everything read.
 */
export const Route = createFileRoute('/_authed/activity')({
  component: ActivityPage,
});

function ActivityPage() {
  const me = useQuery(meQuery);
  const feed = useInfiniteQuery(activityFeedQuery);
  const unread = useQuery(unreadActivityQuery);
  useMarkSeen(Math.max(unread.data ?? 0, feed.data?.pages[0]?.unreadCount ?? 0));
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
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  } else if (feed.data.pages[0]?.items.length === 0) {
    body = (
      <EmptyState icon={Activity} title="Nothing here yet">
        Changes in your groups will appear here.
      </EmptyState>
    );
  } else {
    const meId = me.data.id;
    const now = new Date();
    body = (
      <>
        <ul className="flex flex-col divide-y rounded-xl border">
          {feed.data.pages.flatMap((page: ActivityFeed) =>
            page.items.map((entry) => (
              <li key={entry.id}>
                <Row
                  entry={entry}
                  meId={meId}
                  now={now}
                  line={describeActivity(entry, {
                    meId,
                    people: page.people,
                    money: (amount, currency) => format({ amount, currency }),
                  })}
                />
              </li>
            )),
          )}
        </ul>
        <div ref={sentinel} />
        {feed.hasNextPage && (
          <Button
            variant="outline"
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
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
      {body}
    </div>
  );
}

/**
 * POST /activity/seen whenever something unread is on record while the page is open: on arrival,
 * and again if the badge finds newer changes meanwhile (the feed then refreshes to show them).
 */
function useMarkSeen(unread: number) {
  const queryClient = useQueryClient();
  const sending = useRef(false);
  useEffect(() => {
    if (unread === 0 || sending.current) return;
    sending.current = true;
    api
      .markActivitySeen()
      .then(async () => {
        queryClient.setQueryData<ActivityFeed>(unreadActivityQuery.queryKey, (old) =>
          old ? { ...old, unreadCount: 0 } : old,
        );
        await queryClient.invalidateQueries({ queryKey: activityFeedQuery.queryKey });
      })
      // Not marking it read is harmless: the badge just stays until the next visit.
      .catch(() => undefined)
      .finally(() => {
        sending.current = false;
      });
  }, [unread, queryClient]);
}

function Row({
  entry,
  line,
  meId,
  now,
}: {
  entry: ActivityEntry;
  line: ActivityLine;
  meId: string;
  now: Date;
}) {
  // Others' changes that involve me stand out (Blueprint 4.9).
  const forMe = entry.involvesMe && entry.actor.id !== meId;
  const effect = line.effect && (
    <span
      className={cn(
        'text-sm',
        line.effect.tone === 'owed'
          ? 'text-emerald-700 dark:text-emerald-400'
          : line.effect.tone === 'owes'
            ? 'text-destructive'
            : 'text-muted-foreground',
      )}
    >
      {line.effect.text}
    </span>
  );
  const content = (
    <>
      <Avatar name={entry.actor.name} src={entry.actor.avatarUrl} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-sm', forMe ? 'font-semibold' : 'text-foreground')}>
          {line.text}
        </span>
        {/* Long edits stay short here; the expense's page has them in full. */}
        {line.detail && (
          <span className="line-clamp-2 text-sm text-muted-foreground">{line.detail}</span>
        )}
        {/* On phones the effect sits under the sentence, leaving it the full width. */}
        {effect && <span className="sm:hidden">{effect}</span>}
        <span className="text-xs text-muted-foreground">
          {entry.groupName && <>{entry.groupName} · </>}
          <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
            {relativeTime(entry.createdAt, now)}
          </time>
        </span>
      </span>
      {effect && <span className="hidden shrink-0 text-right sm:block">{effect}</span>}
    </>
  );
  const className = cn('flex items-start gap-3 p-3', forMe && 'bg-accent/40');
  const link = line.link;
  if (!link) return <div className={className}>{content}</div>;
  const linkClass = cn(className, 'hover:bg-muted');
  switch (link.to) {
    case '/transactions/$id':
      return (
        <Link to={link.to} params={link.params} className={linkClass}>
          {content}
        </Link>
      );
    case '/groups/$groupId':
      return (
        <Link to={link.to} params={link.params} className={linkClass}>
          {content}
        </Link>
      );
    case '/friends/$userId':
      return (
        <Link to={link.to} params={link.params} className={linkClass}>
          {content}
        </Link>
      );
  }
}
