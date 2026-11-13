import { useState, type ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export const CODE_LENGTH = 6;

/**
 * The code entry: six boxes over one real, transparent input. Because it's a single input,
 * autofill from the email (autocomplete="one-time-code"), paste, deletion and screen readers all
 * behave as in any text field, and phones open the numeric keypad.
 */
export function OtpInput({
  value,
  onChange,
  invalid = false,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className={cn('relative', className)}>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        aria-invalid={invalid || undefined}
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
      />
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <div
            key={i}
            className={cn(
              'flex h-14 items-center justify-center rounded-lg border bg-card text-2xl font-extrabold tabular-nums transition-shadow',
              focused && i === active && 'border-primary ring-3 ring-focus-ring',
              invalid && 'border-destructive',
              props.disabled && 'opacity-45',
            )}
          >
            {value[i] ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}
