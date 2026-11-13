import { MAX_AMOUNT_MINOR } from '../money/constants';
import { assertFractionDigits, parseScaledDecimal } from '../money/decimal';
import { isSelf, normalizeName } from '../resolve/resolve';
import type { Minor } from '../types';

/**
 * The rule-based parser (Blueprint 8.2): turns a simple sentence such as "I paid 2400 for dinner
 * with Rahul and Amit" into an expense, instantly and without any service. It only claims high
 * confidence when it understood everything; anything it doesn't handle makes the result low
 * confidence rather than a guess.
 */

export type RuleParseInput = {
  text: string;
  /** Today in the person's time zone, "YYYY-MM-DD", for "today" and "yesterday". */
  today: string;
  /** The group's currency: an amount named in another one isn't used. */
  currency: string;
  /** That currency's decimal places (INR 2, JPY 0). */
  minorUnits: number;
  /**
   * Names of the people who could be meant. Lets bare names count as people ("2400 dinner pranav
   * rahul"): a word is a name when it equals a word of one of these.
   */
  knownNames?: readonly string[];
};

/** Why a result isn't high confidence. */
export type Doubt =
  | 'NO_AMOUNT'
  | 'SEVERAL_AMOUNTS'
  | 'AMOUNT_INVALID'
  | 'CURRENCY_MISMATCH'
  | 'UNSUPPORTED'
  | 'PAYER_UNCLEAR'
  | 'SPLIT_UNCLEAR'
  | 'DATE_UNCLEAR';

export type RuleParse = {
  /** The total in minor units, when exactly one valid amount in the group's currency was found. */
  amount: Minor | null;
  /** What's left once amounts, people, dates and instructions are taken out ("Dinner"). */
  description: string | null;
  /** "today" or "yesterday" resolved, else null (the form keeps its default). */
  date: string | null;
  /** Who paid. Unstated means the person typing (the usual case). */
  payer: { kind: 'me' } | { kind: 'person'; name: string };
  /** The people named as sharing it, as typed, without the person typing. */
  people: string[];
  /** Split among everyone in the group: said so, or nobody was named. */
  everyone: boolean;
  confidence: 'high' | 'low';
  doubts: Doubt[];
};

type Kind = 'num' | 'word' | 'cur' | 'sep' | 'pct' | 'other';
type Token = { kind: Kind; text: string; lower: string; start: number; end: number; k: boolean };

const TOKEN =
  /(?<cur>[₹$€£])|(?<num>\d[\d,]*(?:\.\d+)?|\.\d+)(?<k>[kK](?![\p{L}\p{N}]))?|(?<pct>%)|(?<word>[\p{L}\p{M}][\p{L}\p{M}'’-]*)|(?<sep>[&,;+])|(?<other>\S)/gu;

const CURRENCIES: Record<string, string> = {
  '₹': 'INR',
  rs: 'INR',
  inr: 'INR',
  rupee: 'INR',
  rupees: 'INR',
  $: 'USD',
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
};

/**
 * Words this parser doesn't handle (Blueprint 8.2): other split methods and exceptions, debts and
 * settlements, other dates, and Hindi/Hinglish grammar. Any of them makes the result low
 * confidence; a later step (the server's LLM) handles those sentences.
 */
const UNSUPPORTED = new Set([
  // splits it can't express
  'only', 'except', 'excluding', 'without', 'but', 'half', 'each', 'per', 'twice', 'double',
  'triple', 'share', 'shares', 'exact', 'exactly', 'percent', 'ratio',
  // debts and payments back
  'owe', 'owes', 'owed', 'lent', 'lend', 'borrowed', 'borrow', 'settle', 'settled', 'back',
  'gave', 'give', 'returned', 'refund',
  // dates other than today and yesterday
  'tomorrow', 'ago', 'last', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday',
  // Hindi/Hinglish
  'ne', 'ke', 'ka', 'ki', 'ko', 'liye', 'diya', 'diye', 'sirf', 'bas', 'mein', 'barabar', 'sab',
  'hum', 'humne', 'kal', 'aur', 'tha', 'thi', 'wala', 'wale', 'aadha', 'maine', 'mujhe',
]); // prettier-ignore

const PAID = new Set(['paid', 'spent']);
const LIST_START = new Set(['with', 'between', 'among', 'amongst']);
const LIST_JOIN = new Set(['and']);
const EVERYONE = new Set(['everyone', 'everybody', 'all', 'group']);
const SPLIT_WORDS = new Set(['split', 'equally', 'evenly', 'equal']);
/** Words that end a list of names, or a payer's name. */
const STOP = new Set([
  'for', 'on', 'at', 'in', 'to', 'of', 'by', 'from', 'the', 'a', 'an', 'paid', 'spent', 'split',
  'equally', 'evenly', 'equal', 'today', 'yesterday', 'with', 'between', 'among', 'amongst',
]); // prettier-ignore
/** Little words trimmed from either end of a description ("for dinner" → "dinner"). */
const FILLER = new Set(['for', 'on', 'of', 'to', 'the', 'a', 'an', 'and', 'at', 'in', 'by']);

export function parseRules(input: RuleParseInput): RuleParse {
  assertFractionDigits(input.minorUnits);
  const tokens = tokenize(input.text);
  const used = new Set<number>();
  const doubts = new Set<Doubt>();
  const lower = (i: number) => tokens[i]?.lower ?? '';
  const known = new Set(input.knownNames?.flatMap((n) => normalizeName(n).split(' ')) ?? []);
  /** A word that can be part of someone's name. */
  const nameWord = (i: number) =>
    tokens[i]?.kind === 'word' &&
    !STOP.has(lower(i)) &&
    !LIST_JOIN.has(lower(i)) &&
    !isReserved(lower(i));
  /**
   * A name starting at `from` and read in `step` direction: its first word, then more words only
   * while they belong to a known name ("Rahul Sharma paid", but "Dinner Rahul paid" is Rahul).
   * Without known names, one word.
   */
  const nameRun = (from: number, step: 1 | -1): number[] => {
    const run: number[] = [];
    for (let i = from; nameWord(i); i += step) {
      if (run.length > 0 && !known.has(normalizeName(tokens[i]!.text))) break;
      run.push(i);
    }
    return step === 1 ? run : run.reverse();
  };

  // ---- things it doesn't handle
  for (const t of tokens) {
    if (t.kind === 'pct' || (t.kind === 'word' && UNSUPPORTED.has(t.lower)))
      doubts.add('UNSUPPORTED');
  }

  // ---- currency and amount
  const named = new Set<string>();
  tokens.forEach((t, i) => {
    const code = CURRENCIES[t.lower];
    if ((t.kind === 'cur' || t.kind === 'word') && code) {
      named.add(code);
      used.add(i);
      // "rs." : the abbreviation's dot goes with it.
      if (tokens[i + 1]?.text === '.' && tokens[i + 1]!.start === t.end) used.add(i + 1);
    }
  });
  if ([...named].some((code) => code !== input.currency)) doubts.add('CURRENCY_MISMATCH');

  const numbers = tokens.flatMap((t, i) => (t.kind === 'num' ? [i] : []));
  let amount: Minor | null = null;
  if (numbers.length === 0) doubts.add('NO_AMOUNT');
  else if (numbers.length > 1) doubts.add('SEVERAL_AMOUNTS');
  else {
    const t = tokens[numbers[0]!]!;
    used.add(numbers[0]!);
    // "2.4k": parse with three more decimal places, which is the same as multiplying by 1,000.
    const scaled = parseScaledDecimal(t.text, input.minorUnits + (t.k ? 3 : 0), true);
    if (scaled === null || scaled === 0n || scaled > BigInt(MAX_AMOUNT_MINOR))
      doubts.add('AMOUNT_INVALID');
    else if (!doubts.has('CURRENCY_MISMATCH')) amount = Number(scaled);
  }

  // ---- date
  let date: string | null = null;
  tokens.forEach((t, i) => {
    if (t.lower !== 'today' && t.lower !== 'yesterday') return;
    used.add(i);
    const value = t.lower === 'today' ? input.today : shiftDate(input.today, -1);
    if (date !== null && date !== value) doubts.add('DATE_UNCLEAR');
    date = value;
  });

  // ---- "split", "equally"
  tokens.forEach((t, i) => {
    if (t.kind === 'word' && SPLIT_WORDS.has(t.lower)) used.add(i);
  });

  // ---- who paid: "I paid", "Rahul paid", "paid by Rahul", "paid by me", or just "paid"
  let payer: RuleParse['payer'] = { kind: 'me' };
  const paidAt = tokens.flatMap((t, i) => (t.kind === 'word' && PAID.has(t.lower) ? [i] : []));
  if (paidAt.length > 1) doubts.add('PAYER_UNCLEAR');
  if (paidAt.length === 1) {
    const p = paidAt[0]!;
    used.add(p);
    let name: number[];
    if (lower(p + 1) === 'by') {
      used.add(p + 1);
      name = nameRun(p + 2, 1);
      if (name.length === 0) doubts.add('PAYER_UNCLEAR');
    } else {
      name = nameRun(p - 1, -1);
      // "Rahul paid" names a payer only if Rahul is someone who could be meant; "taxi paid" or
      // an unknown name is a question, not a guess. ("paid by Zara" is explicit, as "with" is.)
      const first = name[0];
      if (
        input.knownNames &&
        first !== undefined &&
        !isSelf(tokens[first]!.text) &&
        !known.has(normalizeName(tokens[first]!.text))
      ) {
        doubts.add('PAYER_UNCLEAR');
        name = [];
      }
      // "Rahul and Amit paid": several payers, which needs the split sheet.
      const before = tokens[p - 1 - name.length];
      if (name.length > 0 && (before?.lower === 'and' || before?.kind === 'sep')) {
        doubts.add('PAYER_UNCLEAR');
      }
    }
    name.forEach((i) => used.add(i));
    const text = name.map((i) => tokens[i]!.text).join(' ');
    if (text && !isSelf(text)) payer = { kind: 'person', name: text };
  }

  // ---- who shares it: "with A, B and C", "between A & B", "with everyone"
  const people: string[] = [];
  let everyone = false;
  let listed = false;
  tokens.forEach((t, w) => {
    if (t.kind !== 'word' || !LIST_START.has(t.lower)) return;
    const items: number[][] = [];
    let i = w + 1;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      if (tok.kind === 'sep' || (tok.kind === 'word' && LIST_JOIN.has(tok.lower))) {
        i++;
        continue;
      }
      // "with the group": "the" is otherwise a stop word.
      const run = lower(i) === 'the' && lower(i + 1) === 'group' ? [i, i + 1] : nameRun(i, 1);
      if (run.length === 0) break;
      items.push(run);
      i = run.at(-1)! + 1;
      // A name not followed by "and" or a separator ends the list ("with Rahul pizza").
      const next = tokens[i];
      if (!next || !(next.kind === 'sep' || LIST_JOIN.has(next.lower))) break;
    }
    if (items.length === 0) return; // "with" alone stays in the description
    listed = true;
    for (let j = w; j < i; j++) {
      // Separators and "and" between names belong to the list; a trailing one doesn't.
      if (j <= items.at(-1)!.at(-1)!) used.add(j);
    }
    for (const item of items) {
      const name = item.map((j) => tokens[j]!.text).join(' ');
      if (EVERYONE.has(normalizeName(name)) || normalizeName(name) === 'the group') everyone = true;
      else if (!isSelf(name)) people.push(name);
    }
  });

  // ---- bare names: "2400 dinner pranav rahul"
  if (!listed && input.knownNames) {
    tokens.forEach((t, i) => {
      if (used.has(i) || t.kind !== 'word' || isReserved(t.lower)) return;
      // "me" among bare names is the person typing; Hindi "main" could be "main course".
      if (t.lower === 'me' || t.lower === 'myself') {
        used.add(i);
        return;
      }
      if (known.has(normalizeName(t.text))) {
        used.add(i);
        people.push(t.text);
      }
    });
  }

  if (payer.kind === 'person' && people.length > 0) {
    // "Rahul paid 500 with Amit": is the person typing in it or not? Ask rather than guess.
    doubts.add('SPLIT_UNCLEAR');
  }

  return {
    amount,
    description: describe(tokens, used),
    date,
    payer,
    people: unique(people),
    everyone: everyone || people.length === 0,
    confidence: doubts.size === 0 ? 'high' : 'low',
    doubts: [...doubts].sort(),
  };
}

/** Words with a meaning of their own, never part of a name. */
function isReserved(word: string): boolean {
  return (
    word in CURRENCIES ||
    PAID.has(word) ||
    LIST_START.has(word) ||
    SPLIT_WORDS.has(word) ||
    UNSUPPORTED.has(word) ||
    word === 'today' ||
    word === 'yesterday'
  );
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const g = m.groups!;
    const kind = (['cur', 'num', 'pct', 'word', 'sep', 'other'] as const).find(
      (k) => g[k] !== undefined,
    )!;
    const raw = g[kind]!;
    const start = m.index;
    tokens.push({
      kind,
      text: raw,
      lower: raw.toLowerCase(),
      start,
      end: start + m[0].length,
      k: g.k !== undefined,
    });
  }
  return tokens;
}

/** The unused words, in order, as typed; little words trimmed from the ends; first letter capital. */
function describe(tokens: Token[], used: Set<number>): string | null {
  const rest = tokens.filter((t, i) => !used.has(i) && t.kind !== 'sep');
  // A little word only when it stands alone: the "A" of "A/C" stays.
  const trim = (t: Token, next: Token | undefined) =>
    t.kind === 'other' || (FILLER.has(t.lower) && next?.start !== t.end);
  while (rest.length && trim(rest[0]!, rest[1])) rest.shift();
  while (rest.length && trim(rest.at(-1)!, undefined)) rest.pop();
  if (rest.length === 0) return null;
  let text = '';
  rest.forEach((t, i) => {
    // Keep what was typed together together ("Domino's", "A/C").
    text += i > 0 && rest[i - 1]!.end === t.start ? t.text : `${i > 0 ? ' ' : ''}${t.text}`;
  });
  text = text.slice(0, 120).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "2026-03-01" shifted by `days`, as a calendar date. */
function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function unique(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = normalizeName(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
