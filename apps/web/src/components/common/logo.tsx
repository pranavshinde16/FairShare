import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/** The FairShare mark: a plus on a primary rounded square (DESIGN_SPEC top bar). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground',
        className,
      )}
    >
      <Plus className="size-[19px]" strokeWidth={1.9} />
    </span>
  );
}

/** The mark and the name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.02em]',
        className,
      )}
    >
      <LogoMark />
      FairShare
    </span>
  );
}
