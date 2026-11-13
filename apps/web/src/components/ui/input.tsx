import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-12 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive-muted',
        className,
      )}
      {...props}
    />
  );
}
