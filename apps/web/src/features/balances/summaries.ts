import type { Group, GroupBalances, Money } from '@fairshare/contracts';
import { useQueries } from '@tanstack/react-query';
import { shortName, type MoneyTone } from '../../lib/money-words';
import { balancesQuery } from './queries';

/**
 * What a group row says beyond my net (DESIGN_SPEC §3): whether the group has any expenses ("no
 * expenses yet" rather than "settled up"), and who I settle with ("Priya N. owes you ₹5,550.00",
 * "Neha J. and Rahul M. owe you", "You owe Rahul M. ₹450.00"). From each group's own balances
 * (GET /groups/:id/balances), the same query the group page uses, so the cache is shared.
 */
export type GroupSummary = {
  /** Undefined while the group's balances load. */
  hasExpenses: boolean | undefined;
  /** The breakdown line, or null when I'm settled up in the group's currency. */
  line: BreakdownLine | null;
};

export type BreakdownLine = {
  /** "Priya N. owes you", "Neha J. and Rahul M. owe you", "You owe Rahul M." */
  text: string;
  /** The amount, only when it's one person (with several, the row's total says it). */
  amount: Money | null;
  tone: MoneyTone;
};

/** Whether anything was ever paid, shared or settled in the group (deleted ones don't count). */
export function hasTransactions(balances: GroupBalances): boolean {
  return balances.breakdown.some(
    (b) =>
      b.paid.amount !== 0 || b.share.amount !== 0 || b.sent.amount !== 0 || b.received.amount !== 0,
  );
}

/** "A", "A and B", "A and 2 others". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(' and ');
  return `${list[0]} and ${list.length - 1} others`;
}

/** Who I settle with in the group's own currency, from its suggested payments. */
export function breakdownLine(
  balances: GroupBalances,
  group: Pick<Group, 'currency' | 'members'>,
): BreakdownLine | null {
  const nameOf = (userId: string) =>
    shortName(group.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone');
  const owed = balances.me.owed.filter((t) => t.currency === group.currency);
  if (owed.length > 0) {
    const who = owed.map((t) => nameOf(t.from));
    return {
      text: `${names(who)} ${owed.length === 1 ? 'owes' : 'owe'} you`,
      amount: owed.length === 1 ? { amount: owed[0]!.amount, currency: group.currency } : null,
      tone: 'owed',
    };
  }
  const owes = balances.me.owes.filter((t) => t.currency === group.currency);
  if (owes.length > 0) {
    return {
      text: `You owe ${names(owes.map((t) => nameOf(t.to)))}`,
      amount: owes.length === 1 ? { amount: owes[0]!.amount, currency: group.currency } : null,
      tone: 'owe',
    };
  }
  return null;
}

/** Summaries for a list of groups, by group id. */
export function useGroupSummaries(groups: Group[]): Map<string, GroupSummary> {
  return useQueries({
    queries: groups.map((group) => balancesQuery(group.id)),
    combine: (results) =>
      new Map(
        groups.map((group, i) => {
          const data = results[i]?.data;
          return [
            group.id,
            {
              hasExpenses: data ? hasTransactions(data) : undefined,
              line: data ? breakdownLine(data, group) : null,
            },
          ];
        }),
      ),
  });
}
