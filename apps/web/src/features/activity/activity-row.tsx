import type { ActivityEntry } from '@fairshare/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { TONE_TEXT } from '../../lib/money-words';
import { relativeTime } from '../../lib/relative-time';
import { cn } from '../../lib/utils';
import type { ActivityLine } from './describe';

/**
 * One feed entry (DESIGN_SPEC §4 ActivityRow): the actor's avatar, the sentence with the people and
 * items in bold, what an edit changed (two lines at most; the expense page has it in full), my
 * effect in its money colour, and "Group · time" with a New pill. Rows that were unread when the
 * page opened are tinted. Others' changes that involve me are semibold.
 */
export function ActivityRow({
  entry,
  line,
  isNew,
  meId,
  now,
}: {
  entry: ActivityEntry;
  line: ActivityLine;
  /** Someone else's change since I last looked: tinted, and labelled "New" (not colour alone). */
  isNew: boolean;
  meId: string;
  now: Date;
}) {
  const forMe = entry.involvesMe && entry.actor.id !== meId;
  const content = (
    <>
      <Avatar
        name={entry.actor.name}
        src={entry.actor.avatarUrl}
        seed={entry.actor.id}
        deleted={entry.actor.isDeleted}
        size={40}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'text-[15px] leading-[21px] break-words',
            forMe ? 'font-semibold' : 'font-medium',
          )}
        >
          {emphasize(line.text, entry.actor.id === meId ? null : entry.actor.name)}
        </span>
        {line.detail && (
          <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-muted-foreground">
            {line.detail}
          </span>
        )}
        {line.effect && (
          <span
            className={cn(
              'mt-0.5 text-sm leading-5 font-bold tabular-nums',
              TONE_TEXT[
                line.effect.tone === 'owed'
                  ? 'owed'
                  : line.effect.tone === 'owes'
                    ? 'owe'
                    : 'neutral'
              ],
            )}
          >
            {line.effect.text}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center text-[13px] leading-5 text-muted-foreground">
          {isNew && (
            <span className="mr-1.5 inline-flex h-5 items-center rounded-full bg-primary px-2 text-[11px] font-extrabold text-primary-foreground">
              New
            </span>
          )}
          {entry.groupName && <>{entry.groupName} · </>}
          <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>
            {relativeTime(entry.createdAt, now)}
          </time>
        </span>
      </span>
    </>
  );
  const className = cn('flex items-start gap-3 px-4 py-3 outline-none', isNew && 'bg-unread');
  const link = line.link;
  if (!link) return <div className={className}>{content}</div>;
  const linkClass = cn(
    className,
    'hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset',
  );
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

/**
 * The sentence with its people and items in bold (DESIGN_SPEC §4): the actor when it isn't me
 * ("Rahul Mehta added …"), and anything in quotes ("‘Parasailing’"). The text itself is unchanged.
 */
export function emphasize(text: string, actor: string | null): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  if (actor && rest.startsWith(actor)) {
    parts.push(<b key="actor">{actor}</b>);
    rest = rest.slice(actor.length);
  }
  const quoted = /‘[^’]*’/g;
  let last = 0;
  for (const match of rest.matchAll(quoted)) {
    parts.push(rest.slice(last, match.index));
    parts.push(<b key={match.index}>{match[0]}</b>);
    last = match.index + match[0].length;
  }
  parts.push(rest.slice(last));
  return parts;
}

/** "Today", "Yesterday", then "Wed, 12 Nov" (with the year when it isn't this year). */
export function dayLabel(iso: string, now: Date, locale?: string): string {
  const then = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  }).format(then);
}
