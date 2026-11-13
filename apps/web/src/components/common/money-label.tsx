import { TONE_TEXT, type MoneyTone } from '../../lib/money-words';
import { cn } from '../../lib/utils';

/**
 * An amount with its words, in the amount's colour (DESIGN_SPEC §4 MoneyLabel). Colour is never the
 * only cue: the words always show. Without an amount (settled up, no expenses yet) only the words
 * show, never "₹0.00".
 *
 * - stacked: 12/600 words over a 15–16/800 amount, right-aligned (list rows).
 * - inline: "you lent ₹600.00" on one line.
 *
 * A space separates words and amount in the text, so it reads (and is found) as one phrase.
 */
export function MoneyLabel({
  words,
  amount,
  tone,
  layout = 'stacked',
  size = 'md',
  className,
}: {
  words: string;
  /** The formatted amount; null or empty for words only. */
  amount?: string | null;
  tone: MoneyTone;
  layout?: 'stacked' | 'inline';
  /** stacked only: md = 15px amount, lg = 16px, card = 16px growing to 20px from `lg`. */
  size?: 'md' | 'lg' | 'card';
  className?: string;
}) {
  const colour = TONE_TEXT[tone];
  if (layout === 'inline') {
    return (
      <span className={cn(colour, className)}>
        {words}
        {amount && (
          <>
            {' '}
            <span className="font-bold tabular-nums">{amount}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <span className={cn('flex shrink-0 flex-col items-end text-right', colour, className)}>
      <span className="text-xs leading-4 font-semibold whitespace-nowrap">{words}</span>
      {amount && (
        <>
          {' '}
          <span
            className={cn(
              'leading-5 font-extrabold whitespace-nowrap tabular-nums',
              size === 'md' ? 'text-[15px]' : 'text-base',
              size === 'card' && 'lg:text-xl lg:leading-7',
            )}
          >
            {amount}
          </span>
        </>
      )}
    </span>
  );
}
