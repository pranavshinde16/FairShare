import { TransactionSnapshot, type ActivityEntry } from '@fairshare/contracts';
import { diffSnapshots, type FieldChange } from '@fairshare/core';

export type Names = (userId: string) => string;
export type Money = (amount: number) => string;

/**
 * One history entry as a sentence: "Asha changed the amount ₹1,200.00 → ₹1,500.00 and added Amit
 * to the split" (Blueprint 4.9: diffs are computed at read time from the before/after snapshots).
 */
export function describeEntry(entry: ActivityEntry, name: Names, money: Money): string {
  const actor = entry.actor.name;
  switch (entry.verb) {
    case 'transaction.created':
      return `${actor} added it`;
    case 'transaction.deleted':
      return `${actor} deleted it`;
    case 'transaction.restored':
      return `${actor} restored it`;
    case 'transaction.updated': {
      const before = TransactionSnapshot.safeParse(entry.before);
      const after = TransactionSnapshot.safeParse(entry.after);
      if (!before.success || !after.success) return `${actor} edited it`;
      const parts = diffSnapshots(before.data, after.data).flatMap((c) =>
        describeChange(c, name, money),
      );
      return parts.length ? `${actor} changed ${joinAnd(parts)}` : `${actor} edited it`;
    }
    default:
      return `${actor}: ${entry.verb}`;
  }
}

function describeChange(change: FieldChange, name: Names, money: Money): string[] {
  switch (change.field) {
    case 'amount':
      return [`the amount ${money(change.from)} → ${money(change.to)}`];
    case 'description':
      return [`the description to “${change.to ?? ''}”`];
    case 'occurredOn':
      return [`the date to ${change.to ? shortDate(change.to) : '—'}`];
    case 'notes':
      return [change.to ? 'the notes' : 'removed the notes'].map((s) => s);
    case 'splitMethod':
      return [`the split to ${change.to ?? 'none'}`];
    case 'currency':
      return [`the currency to ${change.to ?? ''}`];
    case 'payers':
    case 'shares': {
      const where = change.field === 'payers' ? 'who paid' : 'the split';
      return [
        ...change.added.map((l) => `added ${name(l.userId)} to ${where}`),
        ...change.removed.map((l) => `removed ${name(l.userId)} from ${where}`),
        ...change.changed.map(
          (c) =>
            `${name(c.userId)}’s ${change.field === 'payers' ? 'payment' : 'share'} ${money(c.from)} → ${money(c.to)}`,
        ),
      ];
    }
  }
}

function joinAnd(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}`;
}

/** "2026-11-03" → "3 Nov" in the browser's language. */
export function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
    new Date(y!, m! - 1, d),
  );
}
