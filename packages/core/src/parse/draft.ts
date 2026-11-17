import { BASIS_POINTS_TOTAL } from '../money/constants';
import {
  isSelf,
  normalizeName,
  resolveName,
  type NameCandidate,
  type Resolution,
} from '../resolve/resolve';
import { MAX_SHARES_PER_PERSON, type SplitInput, type SplitMethod } from '../split/computeShares';
import type { Minor, UserId } from '../types';
import { parseScaledDecimal, toDecimalString } from '../money/decimal';
import { readAmount } from './amount';
import type { RuleParse } from './rules';

/**
 * What a model extracted from a typed sentence (Blueprint 8.5): every number still a string,
 * every person a name as written. Mirrors contracts' LlmExpenseExtraction (a compat test keeps
 * them in step); core can't import zod.
 */
export type Extraction = {
  amount: string | null;
  currency: string | null;
  description: string | null;
  date: string | null;
  payer: { kind: 'me' | 'person' | 'unknown'; name: string | null };
  people: { name: string; isMe: boolean }[];
  includesEveryone: boolean;
  split: { method: SplitMethod; values: { name: string; value: string }[] | null };
  category: string | null;
  notes: string | null;
};

/** The same codes as contracts' PARSE_ISSUE_CODES. */
export type DraftIssueCode =
  | 'AMOUNT_MISSING'
  | 'AMOUNT_INVALID'
  | 'CURRENCY_MISMATCH'
  | 'DATE_INVALID'
  | 'PAYER_UNKNOWN'
  | 'SPLIT_SUM_MISMATCH'
  | 'PERCENT_SUM_INVALID'
  | 'SPLIT_VALUE_INVALID';

export type DraftIssue = { code: DraftIssueCode; message: string };

/** A name from the text, matched against the group: where it was named, and its split value. */
export type NamedResolution = Resolution & {
  role: 'payer' | 'participant';
  /** Its amount, percentage or shares as written (exact, percent and shares splits). */
  value: string | null;
};

export type DraftContext = {
  /** The person typing. */
  meId: UserId;
  /** The group's members who can take part, the person typing included. */
  candidates: readonly NameCandidate[];
  currency: string;
  minorUnits: number;
  /** The latest date an expense may have ("YYYY-MM-DD"). */
  latestDate: string;
};

/** The expense as far as the text settles it. Unsettled names are left out and listed. */
export type ParsedDraft = {
  amount: Minor | null;
  description: string | null;
  occurredOn: string | null;
  payerId: UserId | null;
  /** How the text says to split it (equal when its values couldn't be used). */
  splitMethod: SplitMethod;
  split: SplitInput | null;
  resolutions: NamedResolution[];
  issues: DraftIssue[];
};

/**
 * Turns an extraction into a draft for the expense form (Blueprint 8.6): amounts through
 * readAmount, percentages through parsePercent, names through resolveName. Nothing the code can't
 * settle is guessed: a name that matches several members, or none, becomes a resolution for the
 * person to answer, and anything inconsistent becomes an issue the form shows.
 *
 * The people sharing it follow the rule-based parser: the names given (the person typing only if
 * the text includes them), or everyone in the group when it says so or names nobody.
 */
export function draftFromExtraction(x: Extraction, ctx: DraftContext): ParsedDraft {
  const issues: DraftIssue[] = [];
  const resolutions: NamedResolution[] = [];
  const issue = (code: DraftIssueCode, message: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message });
  };
  const valueOf = new Map(
    (x.split.method === 'equal' ? [] : (x.split.values ?? [])).map((v) => [
      normalizeName(v.name),
      v.value,
    ]),
  );
  /** A name to a member, or null (recorded as a resolution to answer). Cached per name. */
  const settled = new Map<string, UserId | null>();
  const settle = (name: string, role: NamedResolution['role'], isMe = false): UserId | null => {
    const key = normalizeName(name);
    if (isMe || isSelf(name) || key === '') return ctx.meId;
    if (!settled.has(`${role}:${key}`)) {
      const r = resolveName(name.trim(), ctx.candidates, ctx.meId);
      const value = role === 'participant' ? (valueOf.get(key) ?? null) : null;
      resolutions.push({ ...r, role, value });
      settled.set(`${role}:${key}`, r.status === 'resolved' ? r.userId : null);
    }
    return settled.get(`${role}:${key}`)!;
  };

  // ---- amount
  let amount: Minor | null = null;
  const currency = x.currency?.trim().toUpperCase() || null;
  if (x.amount === null || x.amount.trim() === '') {
    issue('AMOUNT_MISSING', 'Enter the amount.');
  } else if (currency !== null && currency !== ctx.currency) {
    issue('CURRENCY_MISMATCH', `That amount is in ${currency}; this group uses ${ctx.currency}.`);
  } else {
    amount = readAmount(x.amount, ctx.minorUnits);
    if (amount === null) issue('AMOUNT_INVALID', `“${x.amount}” isn’t an amount the form can use.`);
  }

  // ---- description and date
  const description = x.description?.replace(/\s+/g, ' ').trim().slice(0, 120) || null;
  let occurredOn: string | null = null;
  if (x.date !== null && x.date.trim() !== '') {
    const date = x.date.trim();
    if (isCalendarDate(date) && date <= ctx.latestDate) occurredOn = date;
    else issue('DATE_INVALID', 'Check the date.');
  }

  // ---- who paid
  let payerId: UserId | null = ctx.meId;
  if (x.payer.kind === 'person') {
    if (x.payer.name === null || x.payer.name.trim() === '') {
      issue('PAYER_UNKNOWN', 'Check who paid.');
    } else {
      payerId = settle(x.payer.name, 'payer');
    }
  }

  // ---- who shares it
  const named = x.people.map((p) => settle(p.name, 'participant', p.isMe));
  // A value for someone not listed among the people still names them as sharing it.
  const listed = new Set(x.people.map((p) => normalizeName(p.name)));
  for (const { name } of x.split.method === 'equal' ? [] : (x.split.values ?? [])) {
    if (!listed.has(normalizeName(name))) named.push(settle(name, 'participant'));
  }
  const everyone = x.includesEveryone || named.length === 0;
  const participants = everyone
    ? ctx.candidates.map((c) => c.userId)
    : unique(named.filter((id): id is UserId => id !== null));

  // ---- the split
  let split: SplitInput | null = null;
  const method = x.split.method;
  if (method !== 'equal' && valueOf.size > 0) {
    split = valuedSplit(method, x, ctx, settle, amount, issue);
  } else {
    if (method !== 'equal') {
      issue('SPLIT_VALUE_INVALID', 'Enter each person’s part of the split.');
    }
    if (participants.length > 0) split = { method: 'equal', participants };
  }

  const splitMethod = method !== 'equal' && valueOf.size > 0 ? method : 'equal';
  return { amount, description, occurredOn, payerId, splitMethod, split, resolutions, issues };
}

/**
 * The rule-based parser's result as an extraction, so the server builds drafts one way whichever
 * parser read the sentence. As in the form, the person typing and the payer share it along with
 * the people named, unless it's everyone.
 */
export function extractionFromRules(parse: RuleParse, minorUnits: number): Extraction {
  const payer = parse.payer.kind === 'person' ? parse.payer.name : null;
  return {
    amount: parse.amount === null ? null : toDecimalString(parse.amount, minorUnits),
    currency: null,
    description: parse.description,
    date: parse.date,
    payer: payer === null ? { kind: 'me', name: null } : { kind: 'person', name: payer },
    people: [
      { name: '', isMe: true },
      ...(payer === null ? [] : [{ name: payer, isMe: false }]),
      ...parse.people.map((name) => ({ name, isMe: false })),
    ],
    includesEveryone: parse.everyone,
    split: { method: 'equal', values: null },
    category: null,
    notes: null,
  };
}

/** An exact, percent or shares split from the values as written. Unsettled names are left out. */
function valuedSplit(
  method: Exclude<SplitMethod, 'equal'>,
  x: Extraction,
  ctx: DraftContext,
  settle: (name: string, role: 'participant') => UserId | null,
  amount: Minor | null,
  issue: (code: DraftIssueCode, message: string) => void,
): SplitInput | null {
  const entries: { userId: UserId | null; value: number }[] = [];
  for (const { name, value } of x.split.values!) {
    const parsed = readValue(method, value, ctx.minorUnits);
    if (parsed === null) {
      issue('SPLIT_VALUE_INVALID', `“${value}” for ${name} isn’t a value the split can use.`);
      continue;
    }
    entries.push({ userId: settle(name, 'participant'), value: parsed });
  }
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  if (method === 'exact' && amount !== null && total !== amount) {
    issue('SPLIT_SUM_MISMATCH', 'The amounts in the split don’t add up to the total.');
  }
  if (method === 'percent' && total !== BASIS_POINTS_TOTAL) {
    issue('PERCENT_SUM_INVALID', 'The percentages don’t add up to 100%.');
  }
  const byUser = new Map<UserId, number>();
  for (const e of entries) {
    if (e.userId !== null) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.value);
  }
  if (byUser.size === 0) return null;
  const list = [...byUser];
  switch (method) {
    case 'exact':
      return { method, amounts: list.map(([userId, value]) => ({ userId, amount: value })) };
    case 'percent':
      return { method, basisPoints: list.map(([userId, bp]) => ({ userId, bp })) };
    case 'shares': {
      if (list.some(([, n]) => n > MAX_SHARES_PER_PERSON)) {
        issue('SPLIT_VALUE_INVALID', `Shares go up to ${MAX_SHARES_PER_PERSON} each.`);
        return null;
      }
      return { method, shares: list.map(([userId, shares]) => ({ userId, shares })) };
    }
  }
}

/** One person's value: an amount, a percentage in basis points, or a whole number of shares. */
function readValue(method: Exclude<SplitMethod, 'equal'>, text: string, minorUnits: number) {
  const value = text.trim();
  if (method === 'exact') return readAmount(value, minorUnits);
  if (method === 'shares') {
    return /^\d{1,4}$/.test(value) && Number(value) >= 1 ? Number(value) : null;
  }
  // Basis points, as parsePercent reads them, without its exception for anything unreadable.
  const bp = parseScaledDecimal(value.replace(/\s*%$/, ''), 2, false);
  return bp !== null && bp > 0n && bp <= BigInt(BASIS_POINTS_TOTAL) ? Number(bp) : null;
}

/** A real calendar date written as YYYY-MM-DD. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return days !== undefined && d >= 1 && d <= days;
}

const unique = (ids: UserId[]) => [...new Set(ids)];
