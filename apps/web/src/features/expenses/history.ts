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
      const changes = describeChanges(entry.before, entry.after, name, money);
      return changes ? `${actor} ${changes}` : `${actor} edited it`;
    }
    default:
      return `${actor}: ${entry.verb}`;
  }
}

/**
 * What an edit changed, without who did it: "changed the amount ₹1,200.00 → ₹1,500.00 and removed
 * the notes". Null when a snapshot can't be read or nothing shows.
 */
export function describeChanges(
  rawBefore: unknown,
  rawAfter: unknown,
  name: Names,
  money: Money,
): string | null {
  const before = TransactionSnapshot.safeParse(rawBefore);
  const after = TransactionSnapshot.safeParse(rawAfter);
  if (!before.success || !after.success) return null;
  const settlement = isSettlement(rawBefore) || isSettlement(rawAfter);
  const changed: string[] = [];
  const did: string[] = [];
  for (const change of diffSnapshots(before.data, after.data)) {
    const words = describeChange(change, settlement, name, money);
    changed.push(...words.changed);
    did.push(...words.did);
  }
  // "changed a, b and c", then what was added or removed: "… and removed the notes".
  const parts = [...changed.map((part, i) => (i === 0 ? `changed ${part}` : part)), ...did];
  return parts.length ? joinAnd(parts) : null;
}

/**
 * An entry's headline for the expense page's timeline (§6.3): "Asha added it", "Asha recorded it",
 * "Asha changed it", "Asha deleted it", "Asha restored it". Its changes go under it, one per line.
 */
export function entryHeadline(entry: ActivityEntry): string {
  const actor = entry.actor.name;
  const settlement = isSettlement(entry.before) || isSettlement(entry.after);
  switch (entry.verb) {
    case 'transaction.created':
      return `${actor} ${settlement ? 'recorded' : 'added'} it`;
    case 'transaction.updated':
      return `${actor} changed it`;
    case 'transaction.deleted':
      return `${actor} deleted it`;
    case 'transaction.restored':
      return `${actor} restored it`;
    default:
      return `${actor}: ${entry.verb}`;
  }
}

/** One line of an edit: "Amount" with "₹18,000.00" → "₹19,500.00", or words alone. */
export type ChangeLine = { label: string; from?: string; to?: string };

/**
 * What an edit changed, one line each (DESIGN_SPEC §6.3): Amount ₹18,000.00 → ₹19,500.00, Your
 * share ₹6,000.00 → ₹6,500.00, Added Amit to the split, Notes removed. Empty when a snapshot can't
 * be read or nothing shows.
 */
export function changeLines(
  rawBefore: unknown,
  rawAfter: unknown,
  name: Names,
  money: Money,
): ChangeLine[] {
  const before = TransactionSnapshot.safeParse(rawBefore);
  const after = TransactionSnapshot.safeParse(rawAfter);
  if (!before.success || !after.success) return [];
  const settlement = isSettlement(rawBefore) || isSettlement(rawAfter);
  const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const date = (value: string | null) => (value ? shortDate(value) : '—');
  const lines: ChangeLine[] = [];
  for (const change of diffSnapshots(before.data, after.data)) {
    switch (change.field) {
      case 'amount':
        lines.push({ label: 'Amount', from: money(change.from), to: money(change.to) });
        break;
      case 'description':
        lines.push({
          label: 'Description',
          from: `“${change.from ?? ''}”`,
          to: `“${change.to ?? ''}”`,
        });
        break;
      case 'occurredOn':
        lines.push({ label: 'Date', from: date(change.from), to: date(change.to) });
        break;
      case 'notes':
        lines.push({
          label: change.to ? (change.from ? 'Notes changed' : 'Notes added') : 'Notes removed',
        });
        break;
      case 'splitMethod':
        lines.push({ label: 'Split', from: change.from ?? 'none', to: change.to ?? 'none' });
        break;
      case 'currency':
        lines.push({ label: 'Currency', from: change.from ?? '', to: change.to ?? '' });
        break;
      case 'paymentMethod': {
        const label = (m: string | null) => (m ? methodLabel(m as PaymentMethod) : 'none');
        lines.push({ label: 'Method', from: label(change.from), to: label(change.to) });
        break;
      }
      case 'paymentRef':
        lines.push(
          change.to
            ? {
                label: 'Reference',
                from: change.from ? `“${change.from}”` : 'none',
                to: `“${change.to}”`,
              }
            : { label: 'Reference removed' },
        );
        break;
      case 'payers':
      case 'shares': {
        if (settlement) {
          // One payer and one recipient: a new person is a new payer or recipient.
          const [added] = change.added;
          const [removed] = change.removed;
          if (added) {
            lines.push({
              label: change.field === 'payers' ? 'Who paid' : 'Who was paid',
              ...(removed && { from: name(removed.userId) }),
              to: name(added.userId),
            });
          }
          break;
        }
        const what = change.field === 'payers' ? 'payment' : 'share';
        const where = change.field === 'payers' ? 'who paid' : 'the split';
        for (const c of change.changed) {
          lines.push({
            label: `${cap(possessive(name(c.userId)))} ${what}`,
            from: money(c.from),
            to: money(c.to),
          });
        }
        for (const l of change.added) lines.push({ label: `Added ${name(l.userId)} to ${where}` });
        for (const l of change.removed) {
          lines.push({ label: `Removed ${name(l.userId)} from ${where}` });
        }
        break;
      }
    }
  }
  return lines;
}

/** Whether a snapshot is a payment's (only those record a method). */
export const isSettlement = (snapshot: unknown) =>
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
