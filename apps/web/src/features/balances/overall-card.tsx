import type { Home } from '@fairshare/contracts';
import { useFormatMoney } from '../../lib/money';
import { cn } from '../../lib/utils';

/**
 * "Overall, you’re owed ₹27,967.00" (DESIGN_SPEC §3), one block per currency; "You’re all settled
 * up" when nothing is owed. From Home's totals: what each group owes me and what I owe, kept apart,
 * then their difference.
 *
 * Phones (m-groups, m-friends): the overall amount with "₹28,417.00 owed to you · ₹450.00 you owe"
 * under it. Desktop (d-home): three stats side by side, Overall · Owed to you · You owe.
 */
export function OverallCard({ totals, className }: { totals: Home['totals']; className?: string }) {
  const format = useFormatMoney();
  return (
    <section
      aria-label="Overall"
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-card lg:px-0 lg:py-[18px]',
        className,
      )}
    >
      {totals.length === 0 ? (
        <p className="text-xl leading-7 font-extrabold tracking-[-0.02em] lg:px-5">
          You’re all settled up
        </p>
      ) : (
        totals.map(({ currency, owed, owe }) => {
          const net = owed - owe;
          const tone = net > 0 ? 'text-owed' : net < 0 ? 'text-owe' : 'text-muted-foreground';
          const stat = 'hidden min-w-0 border-l px-5 py-1 lg:block';
          const statLabel = 'text-sm font-semibold text-muted-foreground';
          const statAmount =
            'mt-1 text-2xl leading-[30px] font-extrabold tracking-[-0.02em] tabular-nums';
          return (
            <div key={currency} className="lg:grid lg:grid-cols-[1.4fr_1fr_1fr]">
              <div className="min-w-0 lg:px-5 lg:py-1">
                <p className={statLabel}>
                  {net > 0 ? 'Overall, you’re owed' : net < 0 ? 'Overall, you owe' : 'Overall'}
                </p>
                <p
                  className={cn(
                    'mt-0.5 text-[34px] leading-10 font-extrabold tracking-[-0.03em] tabular-nums lg:mt-1 lg:tracking-[-0.02em]',
                    tone,
                  )}
                >
                  {net === 0 ? 'settled up' : format({ amount: net, currency })}
                </p>
                <p className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground lg:hidden">
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
              <div className={stat}>
                <p className={statLabel}>Owed to you</p>
                <p className={cn(statAmount, 'text-owed')}>{format({ amount: owed, currency })}</p>
              </div>
              <div className={stat}>
                <p className={statLabel}>You owe</p>
                <p className={cn(statAmount, 'text-owe')}>{format({ amount: owe, currency })}</p>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
