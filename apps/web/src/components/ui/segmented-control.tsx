import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * The segmented control (DESIGN_SPEC §4): a muted track with 3px padding, the active segment on the
 * card colour with a small shadow. Group tabs, split modes, payment method, appearance, payer mode.
 *
 * The class helpers are exported for segments that aren't buttons: the group tabs are links (the
 * tab is in the URL), and the appearance setting is native radios.
 */
export const segmentTrack = 'flex gap-0.5 rounded-[13px] bg-muted p-[3px]';

export const segmentItem = (active: boolean) =>
  cn(
    'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-1.5 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary [&_svg]:size-4 [&_svg]:shrink-0',
    active
      ? 'bg-card font-bold text-foreground shadow-[0_1px_3px_rgba(0,0,0,.12)]'
      : 'font-semibold text-muted-foreground hover:text-foreground',
  );

export type Segment<T extends string> = {
  value: T;
  label: ReactNode;
  /** The accessible name, when it differs from what's shown ("%" → "Percentages"). */
  name?: string;
};

/** Buttons that say which one is chosen with aria-pressed. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name, when no visible legend names it. */
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn(segmentTrack, className)}>
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          aria-label={segment.name}
          aria-pressed={value === segment.value}
          onClick={() => onChange(segment.value)}
          className={segmentItem(value === segment.value)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  );
}
