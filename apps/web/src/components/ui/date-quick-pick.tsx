import { CalendarDays } from 'lucide-react';
import { cn } from '../../lib/utils';

/** A quick-pick chip: 44px, radius 12; the chosen one is filled with the primary colour. */
const chip = (selected: boolean) =>
  cn(
    'relative inline-flex h-11 shrink-0 items-center gap-2 rounded-md px-3.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-focus-ring [&_svg]:size-4 [&_svg]:shrink-0',
    selected
      ? 'bg-primary font-bold text-primary-foreground'
      : 'border bg-card font-semibold text-foreground hover:bg-muted',
  );

/** "2026-11-03" → "3 Nov" (or "3 Nov 2026" `withYear`) in the browser's language. */
export function shortDate(isoDate: string, withYear = false): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear && { year: 'numeric' }),
  }).format(new Date(y!, m! - 1, d));
}

/**
 * Today · Yesterday · Pick a date (DESIGN_SPEC §4 DateQuickPick). "Pick a date" is the browser's own
 * date input under the chip (no calendar library: the CSP-safe, accessible choice); it opens the
 * picker on click, Enter or Space, and shows the chosen date once it's neither today nor yesterday.
 */
export function DateQuickPick({
  value,
  onChange,
  today,
  yesterday,
  min = '2000-01-01',
  className,
}: {
  value: string;
  onChange: (date: string) => void;
  /** Today and yesterday in the person's time zone, "YYYY-MM-DD". */
  today: string;
  yesterday: string;
  min?: string;
  className?: string;
}) {
  const custom = value !== today && value !== yesterday;
  const openPicker = (input: HTMLInputElement) => {
    try {
      input.showPicker();
    } catch {
      // Not allowed here (no user gesture) or unsupported: typing the date still works.
    }
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {(
        [
          ['Today', today],
          ['Yesterday', yesterday],
        ] as const
      ).map(([label, date]) => (
        <button
          key={label}
          type="button"
          aria-pressed={value === date}
          onClick={() => onChange(date)}
          className={chip(value === date)}
        >
          {label}
        </button>
      ))}
      <label className={cn(chip(custom), 'cursor-pointer')}>
        <span aria-hidden>{custom ? shortDate(value, true) : 'Pick a date'}</span>
        <CalendarDays aria-hidden />
        <input
          type="date"
          aria-label="Pick a date"
          min={min}
          value={value}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          onClick={(event) => openPicker(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openPicker(event.currentTarget);
            }
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
