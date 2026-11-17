import type { Group, ParseResult, SplitMethod } from '@fairshare/contracts';
import {
  DomainError,
  parsePercent,
  parseRules,
  readAmount,
  resolveName,
  toDecimalString,
  type NameCandidate,
} from '@fairshare/core';
import { formatAmountInput } from '../../lib/money';
import {
  canTakePart,
  emptySplit,
  percentText,
  splitDraftFrom,
  type ExpenseDraft,
} from '../expenses/split-draft';

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
  /**
   * Whether answering puts them in the split. The rule-based parser counts the payer in; a server
   * read lists the payer and each person sharing separately.
   */
  joins: boolean;
  /** Their part of an exact, percent or shares split, as the form takes it ("500.00", "60", 2). */
  value?: string | number;
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

/** The members who can take part in a new expense, as names to match. */
export function candidatesOf(group: Group): NameCandidate[] {
  return group.members.filter(canTakePart).map((m) => ({ userId: m.user.id, name: m.user.name }));
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
        ? { name, role, joins: true, status: 'ambiguous', candidates: r.candidates }
        : { name, role, joins: true, status: 'unknown' },
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
    next.amountText = formatAmountInput(parsed.amount, ctx.minorUnits);
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

/**
 * A server read of the sentence (Blueprint 8.1: the LLM path) into `draft`, the same way applyEntry
 * reads one locally: what it settled fills the form, names it couldn't settle become chips, and
 * what the text doesn't mention keeps its value.
 */
export function applyParsed(
  result: ParseResult,
  draft: ExpenseDraft,
  ctx: { meId: string; minorUnits: number },
): EntryResult {
  const { draft: read } = result;
  const filled: EntryResult['filled'] = ['split'];
  const next: ExpenseDraft = {
    ...draft,
    payers: { mode: 'single', userId: read.payerId ?? ctx.meId },
    split: read.split
      ? splitDraftFrom(read.split, ctx.minorUnits)
      : { ...emptySplit([]), method: read.splitMethod },
  };
  if (read.amount !== null) {
    next.amountText = formatAmountInput(read.amount, ctx.minorUnits);
    filled.push('amount');
  }
  if (read.description !== null) {
    next.description = read.description;
    filled.push('description');
  }
  if (read.occurredOn !== null) {
    next.occurredOn = read.occurredOn;
    filled.push('date');
  }
  const pending: Pending[] = result.resolutions.flatMap((r): Pending[] => {
    if (r.status === 'resolved') return [];
    const value =
      r.role === 'participant' && r.value !== null
        ? formValue(read.splitMethod, r.value, ctx.minorUnits)
        : undefined;
    const base = {
      name: r.name,
      role: r.role,
      joins: r.role === 'participant',
      ...(value !== undefined && { value }),
    };
    return [
      r.status === 'ambiguous'
        ? { ...base, status: 'ambiguous', candidates: r.candidates.map((c) => c.id) }
        : { ...base, status: 'unknown' },
    ];
  });
  const understood = result.path !== 'fallback';
  return {
    draft: next,
    pending,
    filled,
    understood,
    confident: understood && pending.length === 0 && result.issues.length === 0,
  };
}

/** One person's split value as the form's input holds it, or undefined if it can't be used. */
function formValue(method: SplitMethod, text: string, minorUnits: number) {
  if (method === 'exact') {
    const amount = readAmount(text, minorUnits);
    return amount === null ? undefined : toDecimalString(amount, minorUnits);
  }
  if (method === 'shares') return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : undefined;
  if (method === 'percent') {
    try {
      return percentText(parsePercent(text.trim().replace(/\s*%$/, '')));
    } catch (error) {
      if (error instanceof DomainError) return undefined;
      throw error;
    }
  }
  return undefined;
}

/**
 * A chip answered: this pending name is `userId` (picked from the candidates, or just added). An
 * equal split takes them in; another method takes their value when the sentence gave one, and is
 * otherwise left to the split sheet.
 */
export function settlePending(draft: ExpenseDraft, pending: Pending, userId: string): ExpenseDraft {
  let split = draft.split;
  if (pending.joins && split.method === 'equal' && !split.participants.includes(userId)) {
    split = { ...split, participants: [...split.participants, userId] };
  }
  if (pending.joins && pending.value !== undefined) {
    if (split.method === 'exact') {
      split = { ...split, exact: { ...split.exact, [userId]: String(pending.value) } };
    } else if (split.method === 'percent') {
      split = { ...split, percent: { ...split.percent, [userId]: String(pending.value) } };
    } else if (split.method === 'shares') {
      split = { ...split, shares: { ...split.shares, [userId]: Number(pending.value) } };
    }
  }
  if (pending.role === 'payer') return { ...draft, payers: { mode: 'single', userId }, split };
  return { ...draft, split };
}

const unique = (ids: string[]) => [...new Set(ids)];
