import type { Group, SplitInput, UpdateExpense } from '@fairshare/contracts';
import {
  allocateProportional,
  BASIS_POINTS_TOTAL,
  computeShares,
  DomainError,
  MAX_AMOUNT_MINOR,
  MAX_SHARES_PER_PERSON,
  parsePercent,
  splitPaymentEqually,
  toDecimalString,
  tryParseMoney,
  type Line,
  type SplitMethod,
} from '@fairshare/core';

/**
 * The Add/Edit expense form's state while someone types (Blueprint 7.3), and everything computed
 * from it. No React here, so every rule is tested on its own.
 */

/** Who paid: one person, or several with what each paid (as typed). */
export type PayersDraft =
  | { mode: 'single'; userId: string }
  /** Every key is someone ticked as a payer; the value is what they paid, as typed. */
  | { mode: 'multiple'; amounts: Record<string, string> };

/**
 * How it's split. Each method keeps its own inputs, so switching tabs and back loses nothing; only
 * the current method's are saved.
 */
export type SplitDraft = {
  method: SplitMethod;
  /** Equal: who's in. */
  participants: string[];
  /** Exact: amounts as typed. */
  exact: Record<string, string>;
  /** Percent: percentages as typed ("33.33"). */
  percent: Record<string, string>;
  /** Shares: whole numbers; 0 leaves someone out. */
  shares: Record<string, number>;
};

export type ExpenseDraft = {
  amountText: string;
  description: string;
  occurredOn: string;
  notes: string;
  payers: PayersDraft;
  split: SplitDraft;
};

/**
 * Whether a member can be put into a new expense: still in the group, and not a deleted account
 * (one stays in a group only while something is owed, to be settled).
 */
export const canTakePart = (m: Group['members'][number]) => m.leftAt === null && !m.user.isDeleted;

export const emptySplit = (participants: string[]): SplitDraft => ({
  method: 'equal',
  participants,
  exact: {},
  percent: {},
  shares: {},
});

/** What's left to assign: positive left over, negative over. Money in minor units, percent in bp. */
export type Left = { amount: number; unit: 'money' | 'percent' };

export type SplitState = {
  /** The total, when it's a valid amount. */
  amount: number | null;
  /** Who paid what, when that's complete and adds up. */
  payers: Line[] | null;
  /** With several payers: the total minus what they paid. */
  payersLeft: number | null;
  /** The split as it will be saved, when it's valid. */
  split: SplitInput | null;
  /** Everyone's share, computed exactly as the server will (same seed). */
  shares: Line[] | null;
  /** Exact and percent splits: what's still to assign. */
  splitLeft: Left | null;
  /** The one thing to fix first (amount, then who paid, then the split), or null. */
  problem: string | null;
};

type Context = {
  /** The expense's ID: the seed for every rounding decision. */
  seed: string;
  minorUnits: number;
  /** Formats minor units in the group's currency. */
  money: (amount: number) => string;
};

/** 3333 → "33.33", 1250 → "12.5", 5000 → "50". */
export function percentText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** A typed percentage in basis points; blank is 0, anything unreadable null. */
function readPercent(text: string): number | null {
  if (text.trim() === '') return 0;
  try {
    return parsePercent(text);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/** A typed amount in minor units; blank is 0, anything unreadable null. */
function readMoney(text: string, minorUnits: number): number | null {
  return text.trim() === '' ? 0 : tryParseMoney(text, minorUnits);
}

/** Typed values by person, or null if any can't be read. Order follows the record's keys. */
function readAll(
  values: Record<string, string>,
  read: (text: string) => number | null,
): { userId: string; value: number }[] | null {
  const result: { userId: string; value: number }[] = [];
  for (const [userId, text] of Object.entries(values)) {
    const value = read(text);
    if (value === null) return null;
    result.push({ userId, value });
  }
  return result;
}

const sum = (values: { value: number }[]) => values.reduce((total, v) => total + v.value, 0);

/** Everything the form shows and saves, from the draft. */
export function evaluate(draft: ExpenseDraft, ctx: Context): SplitState {
  const { minorUnits, money } = ctx;
  const parsed = tryParseMoney(draft.amountText, minorUnits);
  const amount = parsed !== null && parsed > 0 && parsed <= MAX_AMOUNT_MINOR ? parsed : null;
  const state: SplitState = {
    amount,
    payers: null,
    payersLeft: null,
    split: null,
    shares: null,
    splitLeft: null,
    problem: null,
  };
  const problems: string[] = [];
  if (amount === null) {
    problems.push(draft.amountText.trim() ? 'Enter a valid amount.' : 'Enter the amount.');
  }

  // ---- who paid
  const payers = draft.payers;
  if (payers.mode === 'single') {
    if (amount !== null) state.payers = [{ userId: payers.userId, amount }];
  } else {
    const typed = readAll(payers.amounts, (t) => readMoney(t, minorUnits));
    if (Object.keys(payers.amounts).length === 0) {
      problems.push('Choose who paid.');
    } else if (typed === null) {
      problems.push('Check the amounts people paid.');
    } else if (amount !== null) {
      const left = amount - sum(typed);
      state.payersLeft = left;
      if (left > 0) problems.push(`${money(left)} of what was paid is still to assign.`);
      else if (left < 0) problems.push(`What people paid is ${money(-left)} more than the total.`);
      else {
        state.payers = typed
          .filter((p) => p.value > 0)
          .map((p) => ({ userId: p.userId, amount: p.value }));
      }
    }
  }

  // ---- the split
  const split = draft.split;
  let input: SplitInput | null = null;
  switch (split.method) {
    case 'equal':
      if (split.participants.length === 0)
        problems.push('Choose at least one person to split with.');
      else input = { method: 'equal', participants: split.participants };
      break;
    case 'exact': {
      const typed = readAll(split.exact, (t) => readMoney(t, minorUnits));
      if (typed === null) {
        problems.push('Check the amounts in the split.');
      } else if (amount !== null) {
        const left = amount - sum(typed);
        state.splitLeft = { amount: left, unit: 'money' };
        if (left > 0) problems.push(`${money(left)} left to assign.`);
        else if (left < 0) problems.push(`The amounts are ${money(-left)} over the total.`);
        else {
          input = {
            method: 'exact',
            amounts: typed
              .filter((t) => t.value > 0)
              .map((t) => ({ userId: t.userId, amount: t.value })),
          };
        }
      }
      break;
    }
    case 'percent': {
      const typed = readAll(split.percent, readPercent);
      if (typed === null) {
        problems.push('Enter percentages like 33.33.');
      } else {
        const left = BASIS_POINTS_TOTAL - sum(typed);
        state.splitLeft = { amount: left, unit: 'percent' };
        if (left > 0) problems.push(`${percentText(left)}% left to assign.`);
        else if (left < 0)
          problems.push(
            `The percentages add up to ${percentText(BASIS_POINTS_TOTAL - left)}%, over 100%.`,
          );
        else {
          input = {
            method: 'percent',
            basisPoints: typed
              .filter((t) => t.value > 0)
              .map((t) => ({ userId: t.userId, bp: t.value })),
          };
        }
      }
      break;
    }
    case 'shares': {
      const entries = Object.entries(split.shares).filter(([, n]) => n > 0);
      if (entries.length === 0) problems.push('Give at least one person a share.');
      else
        input = {
          method: 'shares',
          shares: entries.map(([userId, shares]) => ({ userId, shares })),
        };
      break;
    }
  }

  if (input && amount !== null) {
    try {
      state.shares = computeShares(amount, input, ctx.seed);
      state.split = input;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      problems.push(error.message);
    }
  }
  state.problem = problems[0] ?? null;
  return state;
}

/** The request body, when the draft is complete and valid. */
export function expenseBody(
  draft: ExpenseDraft,
  state: SplitState,
  currency: string,
): UpdateExpense | null {
  const description = draft.description.trim();
  if (state.problem || !description || !state.amount || !state.payers || !state.split) return null;
  const notes = draft.notes.trim();
  return {
    description,
    amount: state.amount,
    currency,
    occurredOn: draft.occurredOn,
    ...(notes && { notes }),
    payers: state.payers,
    split: state.split,
  };
}

/**
 * An expense as a draft, for editing (or reopening one that failed to save): percent and shares
 * reopen exactly as entered (Blueprint 7.3 "Edit mode"). An expense saved without its split input
 * reopens as exact amounts.
 */
export function draftFromExpense(
  expense: {
    amount: number;
    description: string;
    occurredOn: string;
    notes?: string | null;
    payers: Line[];
    split: SplitInput | null;
    shares?: Line[];
  },
  minorUnits: number,
): ExpenseDraft {
  const text = (amount: number) => toDecimalString(amount, minorUnits);
  const split = expense.split ?? {
    method: 'exact' as const,
    amounts: expense.shares ?? [],
  };
  const draft = emptySplit(split.method === 'equal' ? split.participants : []);
  draft.method = split.method;
  if (split.method === 'exact') {
    draft.exact = Object.fromEntries(split.amounts.map((a) => [a.userId, text(a.amount)]));
    draft.participants = split.amounts.map((a) => a.userId);
  }
  if (split.method === 'percent') {
    draft.percent = Object.fromEntries(split.basisPoints.map((p) => [p.userId, percentText(p.bp)]));
    draft.participants = split.basisPoints.map((p) => p.userId);
  }
  if (split.method === 'shares') {
    draft.shares = Object.fromEntries(split.shares.map((s) => [s.userId, s.shares]));
    draft.participants = split.shares.filter((s) => s.shares > 0).map((s) => s.userId);
  }
  return {
    amountText: text(expense.amount),
    description: expense.description,
    occurredOn: expense.occurredOn,
    notes: expense.notes ?? '',
    payers:
      expense.payers.length === 1
        ? { mode: 'single', userId: expense.payers[0]!.userId }
        : {
            mode: 'multiple',
            amounts: Object.fromEntries(expense.payers.map((p) => [p.userId, text(p.amount)])),
          },
    split: draft,
  };
}

/**
 * Switching split method. The new tab starts from the current split when it has nothing of its
 * own yet: exact from everyone's current share, percent as an even split of 100% (rounded by the
 * same seed), shares as 1 each for whoever is in.
 */
export function switchMethod(
  split: SplitDraft,
  method: SplitMethod,
  { shares, seed, minorUnits }: { shares: Line[] | null; seed: string; minorUnits: number },
): SplitDraft {
  const inSplit = shares?.map((s) => s.userId) ?? split.participants;
  const empty = (values: Record<string, unknown>) =>
    Object.values(values).every((v) => v === '' || v === 0);
  const next: SplitDraft = { ...split, method };
  if (method === 'exact' && empty(split.exact) && shares) {
    next.exact = Object.fromEntries(
      shares.map((s) => [s.userId, toDecimalString(s.amount, minorUnits)]),
    );
  }
  if (method === 'percent' && empty(split.percent) && inSplit.length > 0) {
    const even = allocateProportional(
      BASIS_POINTS_TOTAL,
      inSplit.map((userId) => ({ userId, weight: 1 })),
      seed,
    );
    next.percent = Object.fromEntries(even.map((l) => [l.userId, percentText(l.amount)]));
  }
  if (method === 'shares' && empty(split.shares)) {
    next.shares = Object.fromEntries(inSplit.map((userId) => [userId, 1]));
  }
  if (method === 'equal' && split.participants.length === 0 && inSplit.length > 0) {
    next.participants = inSplit;
  }
  return next;
}

/** "Assign remaining to…" (exact): give what's left to one person. Null if it would go negative. */
export function assignRemaining(
  split: SplitDraft,
  userId: string,
  left: number,
  minorUnits: number,
): SplitDraft | null {
  const current = readMoney(split.exact[userId] ?? '', minorUnits);
  if (current === null || current + left < 0) return null;
  return {
    ...split,
    exact: { ...split.exact, [userId]: toDecimalString(current + left, minorUnits) },
  };
}

/** "Fill remainder" (percent): give the rest of 100% to one person. Null if it would go negative. */
export function fillRemainder(
  split: SplitDraft,
  userId: string,
  leftBp: number,
): SplitDraft | null {
  const current = readPercent(split.percent[userId] ?? '');
  if (current === null || current + leftBp < 0) return null;
  return { ...split, percent: { ...split.percent, [userId]: percentText(current + leftBp) } };
}

/** A share count from a stepper or typed digits, kept within 0..MAX_SHARES_PER_PERSON. */
export function clampShares(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_SHARES_PER_PERSON, Math.max(0, Math.trunc(value)))
    : 0;
}

/**
 * "Split payment equally" between the people ticked as payers (Blueprint 4.5: the same rounding as
 * shares, with its own seed). Someone whose part rounds to nothing is left at 0.
 */
export function splitPaymentEvenly(
  payers: Extract<PayersDraft, { mode: 'multiple' }>,
  amount: number,
  seed: string,
  minorUnits: number,
): PayersDraft {
  const ids = Object.keys(payers.amounts);
  const lines = splitPaymentEqually(amount, ids, seed);
  const paid = new Map(lines.map((l) => [l.userId, l.amount]));
  return {
    mode: 'multiple',
    amounts: Object.fromEntries(
      ids.map((id) => [id, toDecimalString(paid.get(id) ?? 0, minorUnits)]),
    ),
  };
}

/** One payer → several: the payer starts with the whole amount (or blank before there is one). */
export function toMultiplePayers(
  payers: PayersDraft,
  amount: number | null,
  minorUnits: number,
): PayersDraft {
  if (payers.mode === 'multiple') return payers;
  return {
    mode: 'multiple',
    amounts: { [payers.userId]: amount === null ? '' : toDecimalString(amount, minorUnits) },
  };
}

/** Several payers → one: whoever paid the most (the first ticked on a tie), else `fallback`. */
export function toSinglePayer(
  payers: PayersDraft,
  fallback: string,
  minorUnits: number,
): PayersDraft {
  if (payers.mode === 'single') return payers;
  let best: { userId: string; paid: number } | null = null;
  for (const [userId, text] of Object.entries(payers.amounts)) {
    const paid = readMoney(text, minorUnits) ?? 0;
    if (!best || paid > best.paid) best = { userId, paid };
  }
  return { mode: 'single', userId: best?.userId ?? fallback };
}

// ---- remembered defaults (Blueprint 7.3 "Smart defaults", per group on this device) ------------

export type Remembered = { payerId?: string; participants?: string[] };

/**
 * A new expense's starting point: the remembered payer (else me) and the remembered participants
 * when they're still all active (else everyone active), split equally.
 */
export function newDraft(
  group: Group,
  meId: string,
  remembered: Remembered,
  today: string,
): ExpenseDraft {
  const active = group.members.filter(canTakePart).map((m) => m.user.id);
  const kept = remembered.participants?.filter((id) => active.includes(id)) ?? [];
  return {
    amountText: '',
    description: '',
    occurredOn: today,
    notes: '',
    payers: {
      mode: 'single',
      userId: remembered.payerId && active.includes(remembered.payerId) ? remembered.payerId : meId,
    },
    split: emptySplit(kept.length > 0 ? kept : active),
  };
}

/** What to remember after a save: one payer, and who an equal split was between. */
export function toRemember(draft: ExpenseDraft): Remembered {
  return {
    ...(draft.payers.mode === 'single' && { payerId: draft.payers.userId }),
    ...(draft.split.method === 'equal' && { participants: draft.split.participants }),
  };
}
