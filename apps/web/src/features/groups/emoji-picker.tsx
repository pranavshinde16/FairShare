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

/** Picks one emoji, or none. Native radios, so it works with the keyboard and screen readers. */
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
      <legend className="mb-2 text-sm font-medium">Emoji</legend>
      <div className="grid grid-cols-7 gap-2 sm:grid-cols-13">
        {options.map((emoji) => (
          <label
            key={emoji ?? 'none'}
            className={cn(
              'flex size-11 cursor-pointer items-center justify-center rounded-lg border text-xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              value === emoji ? 'border-primary bg-accent' : 'hover:bg-muted',
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
            {emoji ?? <span className="text-xs text-muted-foreground">None</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
