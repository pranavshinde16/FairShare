import { byUserId } from '../split/allocate';
import type { PaymentMethod } from '../ledger/types';
import type { SplitInput, SplitMethod } from '../split/computeShares';
import type { Line, Minor, UserId } from '../types';

/**
 * What a transaction looked like at one moment, as stored in the activity log's before/after.
 * Arrays are sorted by userId (see canonicalSnapshot) so equal states always serialize identically.
 *
 * A settlement also records how it was paid (paymentMethod, paymentRef), so changing only the
 * method is a real edit with its own history line. Expenses leave both out, which keeps their
 * snapshots exactly as they were before settlements existed.
 */
export type TransactionSnapshot = {
  description: string;
  amount: Minor;
  currency: string;
  occurredOn: string;
  notes: string | null;
  splitMethod: SplitMethod | null;
  splitInput: SplitInput | null;
  payers: Line[];
  shares: Line[];
  paymentMethod?: PaymentMethod;
  paymentRef?: string | null;
};

export type ScalarField =
  | 'description'
  | 'currency'
  | 'occurredOn'
  | 'notes'
  | 'splitMethod'
  | 'paymentMethod'
  | 'paymentRef';

export type LinesChange = {
  field: 'payers' | 'shares';
  added: Line[];
  removed: Line[];
  changed: { userId: UserId; from: Minor; to: Minor }[];
};

export type FieldChange =
  | { field: ScalarField; from: string | null; to: string | null }
  | { field: 'amount'; from: Minor; to: Minor }
  | LinesChange;

/** Sorts every array in a snapshot by userId, without mutating the input. */
export function canonicalSnapshot(snapshot: TransactionSnapshot): TransactionSnapshot {
  return {
    ...snapshot,
    splitInput: snapshot.splitInput && canonicalSplitInput(snapshot.splitInput),
    payers: sortLines(snapshot.payers),
    shares: sortLines(snapshot.shares),
  };
}

/**
 * The changes between two snapshots of the same transaction, in a fixed field order. The web app
 * turns these into sentences such as "changed the amount ₹1,200 → ₹1,500 and removed Amit".
 *
 * splitInput isn't diffed separately: its effect shows up in splitMethod and the share changes.
 */
export function diffSnapshots(
  before: TransactionSnapshot,
  after: TransactionSnapshot,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const scalar = (field: ScalarField) => {
    // A field a snapshot leaves out (an expense's payment fields) counts as null.
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (from !== to) changes.push({ field, from, to });
  };

  scalar('description');
  if (before.amount !== after.amount)
    changes.push({ field: 'amount', from: before.amount, to: after.amount });
  scalar('currency');
  scalar('occurredOn');
  scalar('notes');
  scalar('splitMethod');
  scalar('paymentMethod');
  scalar('paymentRef');

  for (const field of ['payers', 'shares'] as const) {
    const change = diffLines(field, before[field], after[field]);
    if (change) changes.push(change);
  }
  return changes;
}

function diffLines(field: LinesChange['field'], before: Line[], after: Line[]): LinesChange | null {
  const old = new Map(before.map((l) => [l.userId, l.amount]));
  const now = new Map(after.map((l) => [l.userId, l.amount]));

  const added = after.filter((l) => !old.has(l.userId));
  const removed = before.filter((l) => !now.has(l.userId));
  const changed = after
    .filter((l) => old.has(l.userId) && old.get(l.userId) !== l.amount)
    .map((l) => ({ userId: l.userId, from: old.get(l.userId)!, to: l.amount }));

  if (added.length + removed.length + changed.length === 0) return null;
  return {
    field,
    added: sortLines(added),
    removed: sortLines(removed),
    changed: changed.sort(byUserId),
  };
}

function sortLines(lines: Line[]): Line[] {
  return lines.map((l) => ({ userId: l.userId, amount: l.amount })).sort(byUserId);
}

/**
 * Entries are rebuilt, not just sorted, so their keys always come in the same order: a split read
 * back from Postgres (jsonb orders keys its own way, `bp` before `userId`) must serialize exactly
 * like one built from a request, or an unchanged edit or a replayed create looks different.
 */
function canonicalSplitInput(input: SplitInput): SplitInput {
  switch (input.method) {
    case 'equal':
      return { method: 'equal', participants: [...input.participants].sort() };
    case 'exact':
      return { method: 'exact', amounts: sortLines(input.amounts) };
    case 'percent':
      return {
        method: 'percent',
        basisPoints: input.basisPoints.map(({ userId, bp }) => ({ userId, bp })).sort(byUserId),
      };
    case 'shares':
      return {
        method: 'shares',
        shares: input.shares.map(({ userId, shares }) => ({ userId, shares })).sort(byUserId),
      };
  }
}
