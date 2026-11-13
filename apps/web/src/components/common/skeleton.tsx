import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** A placeholder shaped like the content that's loading (Blueprint 7.1: no full-page spinners). */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-lg bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
