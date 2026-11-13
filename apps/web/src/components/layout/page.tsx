import { Link, type LinkProps } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * A page's columns (DESIGN_SPEC §1, §2): the content, and from `lg` an optional right rail (≥300px:
 * a balance summary, history or recent activity) beside it. Below `lg` the rail's content isn't
 * shown unless the page also puts it in the column.
 */
export function PageLayout({
  children,
  rail,
  className,
}: {
  children: ReactNode;
  rail?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col lg:mx-0 lg:flex-row lg:items-start lg:gap-7',
        rail ? 'max-w-[1120px]' : 'max-w-[760px]',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 lg:gap-[18px]">{children}</div>
      {rail && (
        <div className="hidden w-[320px] shrink-0 flex-col gap-[18px] lg:sticky lg:top-[92px] lg:flex">
          {rail}
        </div>
      )}
    </div>
  );
}

/**
 * The large title of a tab's root page (Groups, Friends, Activity, Account): 30/36, 800, −0.03em,
 * with an optional round action beside it.
 */
export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 pt-0.5 pb-1 lg:pt-0">
      <h1 className="min-w-0 flex-1 text-[30px] leading-9 font-extrabold tracking-[-0.03em]">
        {children}
      </h1>
      {action}
    </header>
  );
}

/** The round 44px action beside a page title ("+" to start a group or add a friend). */
export const titleActionClass =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-card text-foreground shadow-card outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary';

/**
 * "← Groups": the way back from a pushed screen on phones (a group, a friend, an expense). Desktop
 * has the sidebar and breadcrumbs instead, unless `desktop` keeps it.
 */
export function BackLink({
  children,
  desktop = false,
  ...link
}: LinkProps & { children: ReactNode; desktop?: boolean }) {
  return (
    <Link
      {...link}
      className={cn(
        '-mt-1 -ml-2 inline-flex h-11 items-center gap-1 self-start rounded-md pr-3 pl-2 text-[15px] font-bold text-primary outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary',
        !desktop && 'lg:hidden',
      )}
    >
      <ArrowLeft aria-hidden className="size-5" strokeWidth={1.9} />
      {children}
    </Link>
  );
}
