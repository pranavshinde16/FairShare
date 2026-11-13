/**
 * "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago"; after a week, the date
 * ("3 Nov", with the year when it isn't this year). In the browser's language.
 */
export function relativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  // Days by calendar date, so 23:50 yesterday is "yesterday" at 00:10.
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const days = day(now) - day(then);
  if (days < 7) return rtf.format(-days, 'day');
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  }).format(then);
}
