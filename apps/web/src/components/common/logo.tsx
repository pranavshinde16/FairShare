import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * The FairShare mark: a plus on a primary rounded square (DESIGN_SPEC top bar). md: 34px (the top
 * bar), lg: 40px (sign-in, invite, legal pages).
 */
export function LogoMark({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-primary text-primary-foreground',
        size === 'lg' ? 'size-10 rounded-[12px]' : 'size-[34px] rounded-[10px]',
        className,
      )}
    >
      <Plus className={size === 'lg' ? 'size-5' : 'size-[19px]'} strokeWidth={1.9} />
    </span>
  );
}

/** The mark and the name. */
export function Logo({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-extrabold tracking-[-0.02em]',
        size === 'lg' ? 'text-[22px]' : 'text-[19px]',
        className,
      )}
    >
      <LogoMark size={size} />
      FairShare
    </span>
  );
}
