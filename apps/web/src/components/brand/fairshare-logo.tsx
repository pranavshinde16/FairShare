import { useId, type ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * FairShare logo — "Overlap": two rounded squares (you and a friend) and the
 * leaf-shaped part you share where they overlap.
 *
 * Colours come from CSS variables (see README): --logo-a, --logo-b, --logo-overlap,
 * switched automatically in .dark. No inline styles, so it is safe under a strict CSP.
 */

type MarkProps = Omit<ComponentProps<'svg'>, 'children'> & {
  /** Accessible name. Pass "" when the mark sits next to visible text ("FairShare"). */
  title?: string;
};

/** The mark on its own. Size it with classes, e.g. className="size-8". */
export function FairShareMark({ title = 'FairShare', className, ...props }: MarkProps) {
  const clipId = useId();
  const decorative = title === '';
  return (
    <svg
      viewBox="-48 -48 96 96"
      className={cn('size-8 shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      focusable="false"
      {...props}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="-46" y="-46" width="60" height="60" rx="18" />
        </clipPath>
      </defs>
      <rect x="-46" y="-46" width="60" height="60" rx="18" className="fill-logo-a" />
      <rect x="-14" y="-14" width="60" height="60" rx="18" className="fill-logo-b" />
      <rect
        x="-14"
        y="-14"
        width="60"
        height="60"
        rx="18"
        className="fill-logo-overlap"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

const SIZES = {
  sm: { mark: 'size-6', text: 'text-[17px]', gap: 'gap-1.5' },
  md: { mark: 'size-8', text: 'text-[22px]', gap: 'gap-2' },
  lg: { mark: 'size-11', text: 'text-[30px]', gap: 'gap-2.5' },
  xl: { mark: 'size-16', text: 'text-[44px]', gap: 'gap-3.5' },
} as const;

/**
 * Mark + wordmark. The wordmark is lowercase "fairshare" in Outfit SemiBold (600);
 * the accessible name stays "FairShare".
 */
export function FairShareLogo({
  size = 'md',
  className,
  label = 'FairShare',
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Accessible name for the whole lockup, e.g. "FairShare home" when it is a link's only content. */
  label?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center', s.gap, className)}
    >
      <FairShareMark title="" className={s.mark} />
      <span
        aria-hidden="true"
        className={cn(
          'font-wordmark font-semibold leading-none tracking-[-0.01em] text-foreground',
          s.text,
        )}
      >
        fairshare
      </span>
    </span>
  );
}

/** App-icon style tile (teal square with the white + mint mark), e.g. for splash or empty states. */
export function FairShareTile({
  className,
  title = 'FairShare',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn(
        'inline-flex size-16 items-center justify-center rounded-[22%] bg-logo-tile',
        className,
      )}
    >
      <FairShareMark
        title=""
        className="size-[64%] [--logo-a:#FFFFFF] [--logo-b:#99F6E4] [--logo-overlap:var(--logo-tile)]"
      />
    </span>
  );
}
