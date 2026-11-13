import { ArrowLeftRight, ReceiptText } from 'lucide-react';
import { TILE_CLASSES, tileTone } from '../../lib/tile';
import { cn } from '../../lib/utils';

/**
 * Group tiles (DESIGN_SPEC §1, §4): 40 in pickers, 48 on Groups home, 56 in the group header on
 * phones, 64 on desktop. The radius is 30% of the size.
 */
const GROUP_SIZES = {
  32: 'size-8 rounded-[10px] text-base',
  40: 'size-10 rounded-[12px] text-xl',
  48: 'size-12 rounded-[14px] text-2xl',
  56: 'size-14 rounded-[17px] text-[28px]',
  64: 'size-16 rounded-[19px] text-[32px]',
} as const;

/**
 * A group's emoji centred on a tinted rounded square; its first letter when it has no emoji. The
 * tint comes from the group's id. Decorative: the group's name is always beside it.
 */
export function GroupTile({
  emoji,
  name,
  seed,
  size = 48,
  className,
}: {
  emoji: string | null;
  name: string;
  /** The group's id, which picks the tint. */
  seed: string;
  size?: keyof typeof GROUP_SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center leading-none',
        GROUP_SIZES[size],
        TILE_CLASSES[tileTone(seed)],
        !emoji && 'font-extrabold',
        className,
      )}
    >
      {emoji ?? Array.from(name.trim())[0]?.toUpperCase() ?? '•'}
    </span>
  );
}

/** The 36px tile in front of a history row: a receipt for an expense, two arrows for a payment. */
export function IconTile({ kind, className }: { kind: 'expense' | 'payment'; className?: string }) {
  const Icon = kind === 'payment' ? ArrowLeftRight : ReceiptText;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-[11px]',
        kind === 'payment' ? 'bg-owed-muted text-owed' : 'bg-accent text-primary',
        className,
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.9} />
    </span>
  );
}
