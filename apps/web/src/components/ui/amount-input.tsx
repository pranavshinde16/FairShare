import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * The big money field (DESIGN_SPEC §4 AmountInput): the currency symbol, then 800-weight tabular
 * digits. Focus shows a 1px primary border and a 3px soft ring. 38px digits for an expense, 32px for
 * a payment. Labelled by a <Label htmlFor={id}> outside it.
 */
export function AmountInput({
  symbol,
  size = 'expense',
  highlighted = false,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'size'> & {
  symbol: string;
  size?: 'expense' | 'payment';
  /** Filled in by a typed sentence, until changed by hand. */
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-2xl border bg-card px-4 transition-shadow focus-within:border-primary focus-within:ring-3 focus-within:ring-focus-ring',
        size === 'expense' ? 'h-[76px]' : 'h-[68px]',
        highlighted && 'bg-accent/60 ring-1 ring-primary/40',
        className,
      )}
    >
      <span aria-hidden className="text-[26px] font-extrabold text-muted-foreground">
        {symbol}
      </span>
      <input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className={cn(
          'w-full min-w-0 flex-1 bg-transparent p-0 font-extrabold tracking-[-0.02em] tabular-nums outline-none placeholder:text-muted-foreground/60',
          size === 'expense' ? 'text-[38px]' : 'text-[32px]',
        )}
        // Lets the dialog it's in give it focus on opening (see Dialog).
        data-autofocus={props.autoFocus ? '' : undefined}
        {...props}
      />
    </div>
  );
}
