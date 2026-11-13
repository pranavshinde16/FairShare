import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';
import { useOnline } from '../../lib/online';
import { Spinner } from '../common/spinner';

/**
 * shadcn/ui's Button, in Direction 04 "Classic" (DESIGN_SPEC §4). Heights 44 / 48 / 52 (44px is the
 * minimum touch target); disabled is 45% opacity and really `disabled`.
 *
 * - default: primary fill · secondary: card with a border · tint: accent fill, primary text
 * - soft: muted fill · ghost: primary text, no fill · plain: foreground text, no fill
 * - destructive: destructive fill · destructive-ghost: destructive text, no fill
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-[15px] font-bold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:outline-1 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border bg-card text-foreground shadow-card hover:bg-muted',
        tint: 'bg-accent text-accent-foreground hover:bg-accent/80',
        soft: 'bg-muted text-foreground hover:bg-muted/70',
        ghost: 'text-primary hover:bg-accent/60',
        plain: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        'destructive-ghost': 'text-destructive hover:bg-destructive-muted',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
        // Kept while screens move to the variants above (Phase 4): the old bordered button.
        outline: 'border bg-card text-foreground hover:bg-muted',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-11 rounded-md px-3 text-sm',
        md: 'h-12 px-5',
        lg: 'h-[52px] px-6 text-base',
        icon: 'size-11 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a Link) with button styles instead of a <button>. */
    asChild?: boolean;
    /** Shows a spinner and disables the button while an action runs. */
    loading?: boolean;
  };

/**
 * A submit button is disabled while offline (Blueprint C9): every form sends to the server, and
 * nothing is queued to send later. The offline banner says why.
 */

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const online = useOnline();
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      className={classes}
      type={type}
      disabled={disabled || loading || (type === 'submit' && !online)}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
