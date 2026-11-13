import type { Home } from '@fairshare/contracts';
import { useFormatMoney } from '../../lib/money';
import { cn } from '../../lib/utils';

/**
 * "Overall, you’re owed ₹27,967.00" with "₹28,417.00 owed to you · ₹450.00 you owe" under it
 * (DESIGN_SPEC §3), one block per currency; "You’re all settled up" when nothing is owed. From
 * Home's totals: what each group owes me and what I owe, kept apart, then their difference.
 */
export function OverallCard({ totals, className }: { totals: Home['totals']; className?: string }) {
  const format = useFormatMoney();
  return (
    <section
      aria-label="Overall"
      className={cn('flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-card', className)}
    >
      {totals.length === 0 ? (
        <p className="text-xl leading-7 font-extrabold tracking-[-0.02em]">You’re all settled up</p>
      ) : (
        totals.map(({ currency, owed, owe }) => {
          const net = owed - owe;
          const tone = net > 0 ? 'text-owed' : net < 0 ? 'text-owe' : 'text-muted-foreground';
          return (
            <div key={currency}>
              <p className="text-sm font-semibold text-muted-foreground">
                {net > 0 ? 'Overall, you’re owed' : net < 0 ? 'Overall, you owe' : 'Overall'}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-[34px] leading-10 font-extrabold tracking-[-0.03em] tabular-nums',
                  tone,
                )}
              >
                {net === 0 ? 'settled up' : format({ amount: net, currency })}
              </p>
              <p className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground">
                <span className="font-bold text-owed tabular-nums">
                  {format({ amount: owed, currency })}
                </span>{' '}
                owed to you ·{' '}
                <span className="font-bold text-owe tabular-nums">
                  {format({ amount: owe, currency })}
                </span>{' '}
                you owe
              </p>
            </div>
          );
        })
      )}
    </section>
  );
}
