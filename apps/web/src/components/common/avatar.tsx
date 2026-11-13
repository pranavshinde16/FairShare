import { useState } from 'react';
import { TILE_CLASSES, tileTone } from '../../lib/tile';
import { cn } from '../../lib/utils';

/** Up to two initials: "Asha Kapoor" → "AK", "bilal" → "B". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((word) => Array.from(word)[0]!.toUpperCase()).join('');
}

/**
 * Sizes in px (DESIGN_SPEC §1): 40 in lists, 36 in dense lists and pickers, 44 in member rows,
 * 56 on Account. The older names stay as aliases: sm = 32, md = 40, lg = 56.
 */
const SIZES = {
  24: 'size-6 text-[9px]',
  32: 'size-8 text-[10px]',
  36: 'size-9 text-[12px]',
  40: 'size-10 text-[13px]',
  44: 'size-11 text-sm',
  56: 'size-14 text-lg',
  64: 'size-16 text-xl',
  sm: 'size-8 text-[10px]',
  md: 'size-10 text-[13px]',
  lg: 'size-14 text-lg',
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * The person's Google picture, or their initials on a tile colour picked from their id (the same
 * colour everywhere). A deleted account is muted. Decorative: whatever shows it also shows the name.
 */
export function Avatar({
  name,
  src,
  seed,
  deleted = false,
  size = 40,
  className,
}: {
  name: string;
  src?: string | null;
  /** The user's id, which picks the tile colour. Falls back to the name. */
  seed?: string;
  deleted?: boolean;
  size?: AvatarSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const classes = cn('shrink-0 rounded-full', SIZES[size], className);
  if (src && !failed && !deleted) {
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
        'inline-flex items-center justify-center leading-none font-extrabold',
        deleted ? 'bg-muted text-muted-foreground' : TILE_CLASSES[tileTone(seed ?? name)],
      )}
    >
      {initials(name)}
    </span>
  );
}
