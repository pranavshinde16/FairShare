import { cn } from '../../lib/utils';

/** A short, useful set; anything else can come later. */
export const GROUP_EMOJIS = [
  '🏖️',
  '✈️',
  '🏠',
  '🍕',
  '🎉',
  '🚗',
  '🏔️',
  '🛒',
  '💼',
  '🎓',
  '⚽',
  '🎬',
];

/**
 * Picks one emoji, or none (DESIGN_SPEC §4 EmojiPicker: a 7-column grid, the chosen one with a 2px
 * primary border on the accent). Native radios, so it works with the keyboard and screen readers.
 */
export function EmojiPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
}) {
  const options: (string | null)[] = [null, ...GROUP_EMOJIS];
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-bold">Emoji</legend>
      <div className="grid grid-cols-7 gap-2">
        {options.map((emoji) => (
          <label
            key={emoji ?? 'none'}
            className={cn(
              'flex aspect-square min-h-11 cursor-pointer items-center justify-center rounded-md text-[22px] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-focus-ring',
              value === emoji
                ? 'border-2 border-primary bg-accent'
                : 'border bg-card hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name="emoji"
              className="sr-only"
              checked={value === emoji}
              onChange={() => onChange(emoji)}
              aria-label={emoji ?? 'No emoji'}
            />
            {emoji ?? <span className="text-xs font-semibold text-muted-foreground">None</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
