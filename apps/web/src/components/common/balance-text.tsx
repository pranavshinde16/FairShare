import type { Money } from '@fairshare/contracts';
import { useFormatMoney } from '../../lib/money';
import { cn } from '../../lib/utils';

/**
 * A balance in words as well as colour (Blueprint 7.1: never colour alone). "group": my net in a
 * group. "person": what someone and I owe each other (+ they owe me).
 */
export function BalanceText({
  balances,
  kind,
  className,
}: {
  balances: Money[];
  kind: 'group' | 'person';
  className?: string;
}) {
  const format = useFormatMoney();
  if (balances.length === 0) {
    return <span className={cn('text-muted-foreground', className)}>settled up</span>;
  }
  return (
    <span className={cn('flex flex-col', className)}>
      {balances.map((money) => {
        const amount = format(money);
        const owed = money.amount > 0;
        const words = owed
          ? kind === 'group'
            ? `you’re owed ${amount}`
            : `owes you ${amount}`
          : `you owe ${amount}`;
        return (
          <span
            key={money.currency}
            className={owed ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}
          >
            {words}
          </span>
        );
      })}
    </span>
  );
}
