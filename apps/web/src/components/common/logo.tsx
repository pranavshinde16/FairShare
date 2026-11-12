import { cn } from '../../lib/utils';

/** The FairShare mark (same as the favicon) and name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-7">
        <rect width="32" height="32" rx="8" fill="#0f766e" />
        <path d="M9 16h14M16 9v14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      FairShare
    </span>
  );
}
