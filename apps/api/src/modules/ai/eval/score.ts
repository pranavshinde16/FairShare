// Scores a model's answers to the evaluation set (phrases.ts), field by field, through exactly the
// code the server uses (draftFromModel): what's scored is the draft the person would see.

import { LlmExpenseExtraction } from '@fairshare/contracts';
import { parsePercent, readAmount, type DraftContext } from '@fairshare/core';
import { draftFromModel } from '../service';
import { MEMBERS, PHRASES, TODAY, type Expected, type Phrase, type Who } from './phrases';

/** The release gate (plan §11 Phase 15): below any of these, the prompt or model isn't shipped. */
export const GATE = { amount: 0.95, participants: 0.9, payer: 0.9, method: 0.9 } as const;

export const FIELDS = [
  'amount',
  'payer',
  'participants',
  'method',
  'values',
  'date',
  'unknown',
] as const;
export type Field = (typeof FIELDS)[number];

/** A member's ID in the evaluation group: "asha", "rahul", … */
const idOf = (who: string) => (who === 'me' ? 'asha' : who.toLowerCase());
const EVERYONE = MEMBERS.map((name) => idOf(name.split(' ')[0]!));

export const EVAL_CONTEXT: DraftContext = {
  meId: 'asha',
  candidates: MEMBERS.map((name) => ({ userId: idOf(name.split(' ')[0]!), name })),
  currency: 'INR',
  minorUnits: 2,
  latestDate: '2027-11-16',
};

/** What the prompt is given for every sentence (as the server sends it). */
export const EVAL_PROMPT = { today: TODAY, currency: 'INR', myName: MEMBERS[0] };

/** A model's answer to one sentence: its raw output, or how the call failed. */
export type Answer = { output: unknown } | { error: string };

export type PhraseScore = { id: string; text: string; wrong: Field[]; invalid: boolean };

export type Report = {
  total: number;
  /** Share of sentences with each field right (date and unknown: of those that have one). */
  accuracy: Record<Field, number>;
  /** Share with every field right. */
  allRight: number;
  invalid: number;
  failures: PhraseScore[];
  passesGate: boolean;
};

export function scorePhrase(phrase: Phrase, answer: Answer | undefined): PhraseScore {
  const parsed =
    answer && 'output' in answer ? LlmExpenseExtraction.safeParse(answer.output) : null;
  if (!parsed?.success) {
    return { id: phrase.id, text: phrase.text, wrong: [...FIELDS], invalid: true };
  }
  const draft = draftFromModel(parsed.data, EVAL_CONTEXT);
  const e = phrase.expect;
  const wrong: Field[] = [];

  if (draft.amount !== (e.amount === null ? null : readAmount(e.amount, 2))) wrong.push('amount');
  if (draft.payerId !== idOf(e.payer)) wrong.push('payer');
  const expectedPeople = e.people === 'everyone' ? EVERYONE : e.people.map(idOf);
  if (!sameSet(settledPeople(draft.split), expectedPeople)) wrong.push('participants');
  if (draft.splitMethod !== e.method) wrong.push('method');
  if (!valuesMatch(draft.split, e)) wrong.push('values');
  if (e.date !== undefined && draft.occurredOn !== e.date) wrong.push('date');
  const unknown = new Set(
    draft.resolutions.filter((r) => r.status === 'unknown').map((r) => r.name.toLowerCase()),
  );
  if (e.unknown && !e.unknown.every((name) => unknown.has(name.toLowerCase()))) {
    wrong.push('unknown');
  }
  return { id: phrase.id, text: phrase.text, wrong, invalid: false };
}

export function scoreAll(answers: Record<string, Answer>, phrases = PHRASES): Report {
  const scores = phrases.map((phrase) => scorePhrase(phrase, answers[phrase.id]));
  const applies = (field: Field, phrase: Phrase) =>
    field === 'date'
      ? phrase.expect.date !== undefined
      : field === 'unknown'
        ? Boolean(phrase.expect.unknown)
        : true;
  const accuracy = Object.fromEntries(
    FIELDS.map((field) => {
      const relevant = phrases.flatMap((phrase, i) => (applies(field, phrase) ? [scores[i]!] : []));
      const right = relevant.filter((s) => !s.wrong.includes(field)).length;
      return [field, relevant.length === 0 ? 1 : right / relevant.length];
    }),
  ) as Record<Field, number>;
  return {
    total: phrases.length,
    accuracy,
    allRight: scores.filter((s) => s.wrong.length === 0).length / phrases.length,
    invalid: scores.filter((s) => s.invalid).length,
    failures: scores.filter((s) => s.wrong.length > 0),
    passesGate: (Object.keys(GATE) as (keyof typeof GATE)[]).every(
      (field) => accuracy[field] >= GATE[field],
    ),
  };
}

/**
 * What a perfect model would answer for a phrase: its expectation as an extraction. Scoring these
 * must give 100%, which checks the expectations and the server's reading of them together.
 */
export function goldenExtraction(phrase: Phrase): LlmExpenseExtraction {
  const e = phrase.expect;
  const name = (who: Who) => (who === 'me' ? 'me' : who);
  const people =
    e.people === 'everyone'
      ? []
      : [
          ...e.people.map((who) => ({ name: name(who), isMe: who === 'me' })),
          ...(e.unknown ?? []).map((n) => ({ name: n, isMe: false })),
        ];
  return {
    amount: phrase.tags.includes('no-total') ? null : e.amount,
    currency: null,
    description: e.description ?? null,
    date: e.date ?? null,
    payer: e.payer === 'me' ? { kind: 'me', name: null } : { kind: 'person', name: e.payer },
    people,
    includesEveryone: e.people === 'everyone',
    split: {
      method: e.method,
      values:
        e.method === 'equal'
          ? null
          : Object.entries(e.values ?? {}).map(([who, value]) => ({
              name: name(who as Who),
              value,
            })),
    },
    category: null,
    notes: null,
  };
}

/** Everyone the split settles. */
function settledPeople(split: ReturnType<typeof draftFromModel>['split']): string[] {
  if (!split) return [];
  switch (split.method) {
    case 'equal':
      return split.participants;
    case 'exact':
      return split.amounts.map((a) => a.userId);
    case 'percent':
      return split.basisPoints.map((p) => p.userId);
    case 'shares':
      return split.shares.map((s) => s.userId);
  }
}

function valuesMatch(split: ReturnType<typeof draftFromModel>['split'], e: Expected): boolean {
  if (e.method === 'equal') return true;
  if (!split || split.method !== e.method) return false;
  const expected = new Map(
    Object.entries(e.values ?? {}).map(([who, value]) => [
      idOf(who),
      e.method === 'exact'
        ? readAmount(value, 2)
        : e.method === 'percent'
          ? parsePercent(value)
          : Number(value),
    ]),
  );
  const actual = new Map<string, number>(
    split.method === 'exact'
      ? split.amounts.map((a) => [a.userId, a.amount])
      : split.method === 'percent'
        ? split.basisPoints.map((p) => [p.userId, p.bp])
        : split.method === 'shares'
          ? split.shares.map((s) => [s.userId, s.shares])
          : [],
  );
  return expected.size === actual.size && [...expected].every(([id, v]) => actual.get(id) === v);
}

const sameSet = (a: string[], b: string[]) =>
  a.length === new Set(a).size &&
  new Set(a).size === new Set(b).size &&
  b.every((x) => a.includes(x));
