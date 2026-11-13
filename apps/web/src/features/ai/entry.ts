import type { Group } from '@fairshare/contracts';
import { formatMoney, parseRules, resolveName, type NameCandidate } from '@fairshare/core';
import { emptySplit, type ExpenseDraft } from '../expenses/split-draft';

/**
 * Typed entry (Blueprint 8.1, 8.2, 8.7): "Dinner 2400 with Rahul & Amit" → the expense form,
 * filled in. core.parseRules reads the sentence; core.resolveName matches the names to the
 * group's members. Names that match several people, or nobody, become chips for the person to
 * settle; nothing is guessed.
 */

/** A name from the sentence still to settle: which of several people, or someone not in the group. */
export type Pending = {
  name: string;
  /** Whether the sentence named them as the payer or as sharing the expense. */
  role: 'payer' | 'participant';
} & ({ status: 'ambiguous'; candidates: string[] } | { status: 'unknown' });

export type Filled = 'amount' | 'description' | 'date' | 'split';

export type EntryResult = {
  draft: ExpenseDraft;
  pending: Pending[];
  /** Fields the sentence filled, highlighted until the person changes them. */
  filled: Filled[];
  /** The sentence was understood (core's confidence gate, before names). */
  understood: boolean;
  /** Understood, and every name settled. */
  confident: boolean;
};

type Context = {
  group: Group;
  meId: string;
  minorUnits: number;
  /** Today in the person's time zone, "YYYY-MM-DD". */
  today: string;
};

/** The group's active members, as names to match. */
export function candidatesOf(group: Group): NameCandidate[] {
  return group.members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ userId: m.user.id, name: m.user.name }));
}

/**
 * Reads `text` into `draft`. What the sentence doesn't mention keeps its current value; the notes
 * are never touched. When it isn't fully understood, the sentence as typed becomes the description
 * (if there is none yet), so nothing typed is lost (Blueprint 8.8).
 */
export function applyEntry(text: string, draft: ExpenseDraft, ctx: Context): EntryResult {
  const candidates = candidatesOf(ctx.group);
  const parsed = parseRules({
    text,
    today: ctx.today,
    currency: ctx.group.currency,
    minorUnits: ctx.minorUnits,
    knownNames: candidates.map((c) => c.name),
  });
  const pending: Pending[] = [];
  const settle = (name: string, role: Pending['role']): string | null => {
    const r = resolveName(name, candidates, ctx.meId);
    if (r.status === 'resolved') return r.userId;
    pending.push(
      r.status === 'ambiguous'
        ? { name, role, status: 'ambiguous', candidates: r.candidates }
        : { name, role, status: 'unknown' },
    );
    return null;
  };

  const payerId = parsed.payer.kind === 'me' ? ctx.meId : settle(parsed.payer.name, 'payer');
  const people = parsed.people.map((name) => settle(name, 'participant'));
  const active = candidates.map((c) => c.userId);
  const participants = parsed.everyone
    ? active
    : unique([
        ctx.meId,
        ...(payerId ? [payerId] : []),
        ...people.flatMap((id) => (id ? [id] : [])),
      ]);

  const filled: Filled[] = ['split'];
  const next: ExpenseDraft = {
    ...draft,
    // An unsettled payer leaves me paying until the chip is answered.
    payers: { mode: 'single', userId: payerId ?? ctx.meId },
    split: emptySplit(participants),
  };
  if (parsed.amount !== null) {
    // As the amount field shows it after typing ("2,400.00").
    next.amountText = formatMoney(parsed.amount, ctx.minorUnits, Intl, { locale: 'en-US' });
    filled.push('amount');
  }
  if (parsed.confidence === 'high') {
    if (parsed.description !== null) {
      next.description = parsed.description;
      filled.push('description');
    }
  } else if (!draft.description.trim()) {
    // Not understood (Blueprint 8.8): keep what was extracted, and the sentence as typed as the
    // description, so nothing is lost.
    next.description = text.trim().slice(0, 120);
    filled.push('description');
  }
  if (parsed.date !== null) {
    next.occurredOn = parsed.date;
    filled.push('date');
  }
  return {
    draft: next,
    pending,
    filled,
    understood: parsed.confidence === 'high',
    confident: parsed.confidence === 'high' && pending.length === 0,
  };
}

/** A chip answered: this pending name is `userId` (picked from the candidates, or just added). */
export function settlePending(draft: ExpenseDraft, pending: Pending, userId: string): ExpenseDraft {
  const split =
    draft.split.method === 'equal' && !draft.split.participants.includes(userId)
      ? { ...draft.split, participants: [...draft.split.participants, userId] }
      : draft.split;
  if (pending.role === 'payer') return { ...draft, payers: { mode: 'single', userId }, split };
  return { ...draft, split };
}

const unique = (ids: string[]) => [...new Set(ids)];
