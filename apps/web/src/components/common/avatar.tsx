import { useState } from 'react';
import { cn } from '../../lib/utils';

/** Up to two initials: "Asha Kapoor" → "AK", "bilal" → "B". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((word) => Array.from(word)[0]!.toUpperCase()).join('');
}

const SIZES = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' } as const;

/**
 * The person's Google picture, or their initials when there is none or it fails to load.
 * Decorative: whatever shows it also shows the name.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const classes = cn('shrink-0 rounded-full', SIZES[size], className);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className={cn(classes, 'object-cover')}
        // Google's image servers refuse requests that carry another site's referrer.
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        classes,
        'inline-flex items-center justify-center bg-accent font-semibold text-accent-foreground',
      )}
    >
      {initials(name)}
    </span>
  );
}
