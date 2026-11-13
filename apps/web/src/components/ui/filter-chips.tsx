import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Filter chips (DESIGN_SPEC §4): 44px pills. Real <select>s and checkboxes underneath, so they work
 * with the keyboard and screen readers as any form control does. An active filter uses the accent.
 */
export const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-focus-ring [&_svg]:size-4 [&_svg]:shrink-0',
    active
      ? 'border-primary bg-accent text-accent-foreground'
      : 'bg-card text-foreground hover:bg-muted',
  );

/** A pill-shaped <select> with its chevron. */
export function ChipSelect({
  active,
  className,
  ...props
}: ComponentProps<'select'> & { active: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <select
        className={cn(chipClass(active), 'appearance-none pr-[38px] pl-4', className)}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2"
      />
    </span>
  );
}

/** A pill with a checkbox inside ("Show deleted"). The label names the checkbox. */
export function ChipToggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={cn(chipClass(checked), 'cursor-pointer gap-2')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-[18px] accent-[var(--primary)]"
      />
      {children}
    </label>
  );
}
