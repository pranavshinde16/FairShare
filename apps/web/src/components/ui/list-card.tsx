import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * Where a row's divider starts (DESIGN_SPEC §4 ListCard: "1px inset dividers, inset = avatar + gap"):
 * none, after a 36px icon tile, a 40px or 44px avatar, or a 48px group tile.
 */
const INSETS = {
  none: '[&>li+li]:before:left-0',
  icon: '[&>li+li]:before:left-[62px]',
  avatar: '[&>li+li]:before:left-[66px]',
  person: '[&>li+li]:before:left-[72px]',
  tile: '[&>li+li]:before:left-[76px]',
} as const;

/** A card holding a list: rows separated by 1px inset dividers. Children are <li> rows. */
export function ListCard({
  className,
  inset = 'avatar',
  ...props
}: ComponentProps<'ul'> & { inset?: keyof typeof INSETS }) {
  return (
    <ul
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-card shadow-card',
        '[&>li+li]:relative [&>li+li]:before:absolute [&>li+li]:before:top-0 [&>li+li]:before:right-0 [&>li+li]:before:h-px [&>li+li]:before:bg-border',
        INSETS[inset],
        className,
      )}
      {...props}
    />
  );
}

/** "NOVEMBER 2026", "PEOPLE YOU KNOW": the spec's 12px caps label above a list. */
export function CapsLabel({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}
