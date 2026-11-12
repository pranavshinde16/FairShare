import { TransactionSnapshot, type ActivityEntry, type PaymentMethod } from '@fairshare/contracts';
import { diffSnapshots, type FieldChange } from '@fairshare/core';
import { methodLabel } from '../settlements/payment';

export type Names = (userId: string) => string;
export type Money = (amount: number) => string;

/**
 * One history entry as a sentence: "Asha changed the amount ₹1,200.00 → ₹1,500.00 and added Amit
 * to the split" (Blueprint 4.9: diffs are computed at read time from the before/after snapshots).
 * A payment reads as one: "Asha changed who paid to Bilal and the method to Cash".
 *
 * `name` may return "you" for the reader; possessives then read "your".
 */
export function describeEntry(entry: ActivityEntry, name: Names, money: Money): string {
  const actor = entry.actor.name;
  const settlement = isSettlement(entry.before) || isSettlement(entry.after);
  switch (entry.verb) {
    case 'transaction.created':
      return `${actor} ${settlement ? 'recorded' : 'added'} it`;
    case 'transaction.deleted':
      return `${actor} deleted it`;
    case 'transaction.restored':
      return `${actor} restored it`;
    case 'transaction.updated': {
      const before = TransactionSnapshot.safeParse(entry.before);
      const after = TransactionSnapshot.safeParse(entry.after);
      if (!before.success || !after.success) return `${actor} edited it`;
      const changed: string[] = [];
      const did: string[] = [];
      for (const change of diffSnapshots(before.data, after.data)) {
        const words = describeChange(change, settlement, name, money);
        changed.push(...words.changed);
        did.push(...words.did);
      }
      // "changed a, b and c", then what was added or removed: "… and removed the notes".
      const parts = [...changed.map((part, i) => (i === 0 ? `changed ${part}` : part)), ...did];
      return parts.length ? `${actor} ${joinAnd(parts)}` : `${actor} edited it`;
    }
    default:
      return `${actor}: ${entry.verb}`;
  }
}

const isSettlement = (snapshot: unknown) =>
  typeof snapshot === 'object' && snapshot !== null && 'paymentMethod' in snapshot;

/** What "changed …" covers, and what reads as its own verb ("added", "removed"). */
type Words = { changed: string[]; did: string[] };

function describeChange(
  change: FieldChange,
  settlement: boolean,
  name: Names,
  money: Money,
): Words {
  const changed = (...parts: string[]): Words => ({ changed: parts, did: [] });
  const did = (...parts: string[]): Words => ({ changed: [], did: parts });
  switch (change.field) {
    case 'amount':
      return changed(`the amount ${money(change.from)} → ${money(change.to)}`);
    case 'description':
      return changed(`the description to “${change.to ?? ''}”`);
    case 'occurredOn':
      return changed(`the date to ${change.to ? shortDate(change.to) : '—'}`);
    case 'notes':
      return change.to ? changed('the notes') : did('removed the notes');
    case 'splitMethod':
      return changed(`the split to ${change.to ?? 'none'}`);
    case 'currency':
      return changed(`the currency to ${change.to ?? ''}`);
    case 'paymentMethod':
      return changed(
        `the method to ${change.to ? methodLabel(change.to as PaymentMethod) : 'none'}`,
      );
    case 'paymentRef':
      return change.to ? changed(`the reference to “${change.to}”`) : did('removed the reference');
    case 'payers':
    case 'shares': {
      if (settlement) {
        // One payer and one recipient: a new person is a new payer or recipient. Their amount
        // always equals the payment's, so an amount change is already "the amount".
        const [person] = change.added;
        if (!person) return changed();
        return changed(
          `${change.field === 'payers' ? 'who paid' : 'who was paid'} to ${name(person.userId)}`,
        );
      }
      const where = change.field === 'payers' ? 'who paid' : 'the split';
      return {
        changed: change.changed.map(
          (c) =>
            `${possessive(name(c.userId))} ${change.field === 'payers' ? 'payment' : 'share'} ${money(c.from)} → ${money(c.to)}`,
        ),
        did: [
          ...change.added.map((l) => `added ${name(l.userId)} to ${where}`),
          ...change.removed.map((l) => `removed ${name(l.userId)} from ${where}`),
        ],
      };
    }
  }
}

const possessive = (name: string) => (name.toLowerCase() === 'you' ? 'your' : `${name}’s`);

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
