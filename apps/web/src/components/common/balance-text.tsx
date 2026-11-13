import type { Money } from '@fairshare/contracts';
import { useFormatMoney } from '../../lib/money';
import { groupWords, personWords } from '../../lib/money-words';
import { cn } from '../../lib/utils';
import { MoneyLabel } from './money-label';

/**
 * A balance in words as well as colour (DESIGN_SPEC §3), one MoneyLabel per currency. "group": my
 * net in a group ("you’re owed", "you owe", "settled up" / "no expenses yet"). "person": what someone
 * and I owe each other (+: they owe me; "owes you", "you owe").
 */
export function BalanceText({
  balances,
  kind,
  layout = 'inline',
  hasExpenses = true,
  className,
}: {
  balances: Money[];
  kind: 'group' | 'person';
  layout?: 'stacked' | 'inline';
  /** group only: whether the group has any expenses, for "no expenses yet" when it's at zero. */
  hasExpenses?: boolean;
  className?: string;
}) {
  const format = useFormatMoney();
  const wordsFor = (amount: number) =>
    kind === 'group' ? groupWords(amount, hasExpenses) : personWords(amount);
  if (balances.length === 0) {
    const { words, tone } = wordsFor(0);
    return <MoneyLabel words={words} tone={tone} layout={layout} className={className} />;
  }
  return (
    <span className={cn('flex flex-col', layout === 'stacked' && 'items-end gap-1', className)}>
      {balances.map((money) => {
        const { words, tone } = wordsFor(money.amount);
        return (
          <MoneyLabel
            key={money.currency}
            words={words}
            amount={format(money)}
            tone={tone}
            layout={layout}
          />
        );
      })}
    </span>
  );
}
