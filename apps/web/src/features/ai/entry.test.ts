import type { Group, ParseResult } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { emptySplit, type ExpenseDraft } from '../expenses/split-draft';
import { applyEntry, applyParsed, settlePending } from './entry';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [ME, RS, RK, AMIT, LEFT] = [id(1), id(2), id(3), id(4), id(5)];
const member = (userId: string, name: string, leftAt: string | null = null) => ({
  user: { id: userId, name, avatarUrl: null, isPlaceholder: false, isDeleted: false },
  role: 'member' as const,
  joinedAt: '2026-11-01T00:00:00.000Z',
  leftAt,
});
const group: Group = {
  id: id(9),
  kind: 'group',
  name: 'Goa Trip',
  emoji: null,
  currency: 'INR',
  createdAt: '2026-11-01T00:00:00.000Z',
  members: [
    member(ME, 'Pranav'),
    member(RS, 'Rahul Sharma'),
    member(RK, 'Rahul Kumar'),
    member(AMIT, 'Amit'),
    member(LEFT, 'Dev', '2026-11-05T00:00:00.000Z'),
  ],
  myRole: 'owner',
};
const blank: ExpenseDraft = {
  amountText: '',
  description: '',
  occurredOn: '2026-11-13',
  notes: 'keep me',
  payers: { mode: 'single', userId: ME },
  split: emptySplit([ME, RS, RK, AMIT]),
};
const ctx = { group, meId: ME, minorUnits: 2, today: '2026-11-13' };
const apply = (text: string, draft = blank) => applyEntry(text, draft, ctx);

describe('applyEntry', () => {
  it('fills the form from a sentence it fully understands', () => {
    const result = apply('I paid 2400 for dinner with Rahul Sharma and Amit yesterday');
    expect(result).toEqual({
      draft: {
        amountText: '2,400.00',
        description: 'Dinner',
        occurredOn: '2026-11-12',
        notes: 'keep me',
        payers: { mode: 'single', userId: ME },
        split: emptySplit([ME, RS, AMIT]),
      },
      pending: [],
      filled: ['split', 'amount', 'description', 'date'],
      understood: true,
      confident: true,
    });
  });

  it('splits among everyone active when nobody is named', () => {
    expect(apply('taxi 600').draft.split.participants).toEqual([ME, RS, RK, AMIT]);
  });

  it('reads a payer from the group, and includes them in a named split', () => {
    expect(apply('Amit paid 900 for snacks').draft).toMatchObject({
      payers: { userId: AMIT },
      split: { participants: [ME, RS, RK, AMIT] },
    });
  });

  it('asks which Rahul, and who Zara is, instead of guessing', () => {
    const result = apply('dinner 2400 with Rahul and Zara');
    // The sentence was clear; the names need answers.
    expect(result).toMatchObject({ understood: true, confident: false });
    expect(result.pending).toEqual([
      {
        name: 'Rahul',
        role: 'participant',
        joins: true,
        status: 'ambiguous',
        candidates: [RS, RK],
      },
      { name: 'Zara', role: 'participant', joins: true, status: 'unknown' },
    ]);
    // Only the settled people are in so far.
    expect(result.draft.split.participants).toEqual([ME]);
  });

  it('holds an unsettled payer as a chip, with me paying meanwhile', () => {
    const result = apply('paid by Rahul 1500 for petrol');
    expect(result.pending).toEqual([
      { name: 'Rahul', role: 'payer', joins: true, status: 'ambiguous', candidates: [RS, RK] },
    ]);
    expect(result.draft.payers).toEqual({ mode: 'single', userId: ME });
  });

  it('keeps the sentence as the description when it can’t follow it', () => {
    // Blueprint 8.8: what was extracted (the amount), and the sentence as the description.
    const result = apply('dinner ka 2400 maine diya');
    expect(result).toMatchObject({ understood: false, confident: false });
    expect(result.draft).toMatchObject({
      amountText: '2,400.00',
      description: 'dinner ka 2400 maine diya',
    });
    expect(result.filled).toEqual(['split', 'amount', 'description']);
    // …but never over a description already typed.
    expect(apply('ka maine diya', { ...blank, description: 'Lunch' }).draft.description).toBe(
      'Lunch',
    );
  });

  it('leaves what the sentence doesn’t mention as it was', () => {
    const typed = { ...blank, amountText: '50', description: 'Tea', occurredOn: '2026-11-01' };
    const result = apply('with Amit', typed);
    expect(result.draft).toMatchObject({
      amountText: '50',
      description: 'Tea',
      occurredOn: '2026-11-01',
    });
    expect(result.filled).toEqual(['split']);
  });

  it('doesn’t match a deleted account', () => {
    const gone = member(id(6), 'Deleted user');
    const withGone = {
      ...group,
      members: [...group.members, { ...gone, user: { ...gone.user, isDeleted: true } }],
    };
    const result = applyEntry('taxi 600 with Amit', blank, { ...ctx, group: withGone });
    expect(result.draft.split.participants).toEqual([ME, AMIT]);
    // Nobody named: everyone who can take part, not the deleted account.
    expect(
      applyEntry('taxi 600', blank, { ...ctx, group: withGone }).draft.split.participants,
    ).toEqual([ME, RS, RK, AMIT]);
  });

  it('ignores members who left', () => {
    expect(apply('taxi 600 with Dev').pending).toEqual([
      { name: 'Dev', role: 'participant', joins: true, status: 'unknown' },
    ]);
  });
});

describe('settlePending', () => {
  it('adds a chosen person to the split', () => {
    const { draft, pending } = apply('dinner 2400 with Rahul and Amit');
    const next = settlePending(draft, pending[0]!, RK);
    expect(next.split.participants).toEqual([ME, AMIT, RK]);
    // Choosing someone already in changes nothing.
    expect(settlePending(next, pending[0]!, RK).split).toBe(next.split);
  });

  it('makes a chosen payer the payer, and puts them in a named split', () => {
    const { draft, pending } = apply('paid by Rahul 1500 for petrol with Amit');
    const next = settlePending(draft, pending[0]!, RS);
    expect(next.payers).toEqual({ mode: 'single', userId: RS });
    expect(next.split.participants).toContain(RS);
  });

  it('leaves a non-equal split to the sheet', () => {
    const { pending } = apply('dinner 2400 with Rahul');
    const draft = { ...blank, split: { ...emptySplit([ME]), method: 'exact' as const } };
    expect(settlePending(draft, pending[0]!, RS).split).toBe(draft.split);
  });
});

describe('applyParsed (the server’s read)', () => {
  const result = (patch: Partial<ParseResult> = {}): ParseResult => ({
    requestId: 7,
    path: 'llm',
    groupId: group.id,
    draft: {
      amount: 100_000,
      description: 'Petrol',
      occurredOn: '2026-11-12',
      payerId: AMIT,
      splitMethod: 'exact',
      split: { method: 'exact', amounts: [{ userId: ME, amount: 40_000 }] },
    },
    resolutions: [
      { name: 'Amit', role: 'payer', value: null, status: 'resolved', userId: AMIT },
      {
        name: 'Rahul',
        role: 'participant',
        value: '₹600',
        status: 'ambiguous',
        candidates: [group.members[1]!.user, group.members[2]!.user],
      },
    ],
    issues: [],
    ...patch,
  });
  const parsed = (r: ParseResult, draft = blank) =>
    applyParsed(r, draft, { meId: ME, minorUnits: 2 });

  it('fills what it settled, and asks about the rest with their values kept', () => {
    expect(parsed(result())).toEqual({
      draft: {
        amountText: '1,000.00',
        description: 'Petrol',
        occurredOn: '2026-11-12',
        notes: 'keep me',
        payers: { mode: 'single', userId: AMIT },
        split: { ...emptySplit([ME]), method: 'exact', exact: { [ME]: '400.00' } },
      },
      pending: [
        {
          name: 'Rahul',
          role: 'participant',
          joins: true,
          value: '600.00',
          status: 'ambiguous',
          candidates: [RS, RK],
        },
      ],
      filled: ['split', 'amount', 'description', 'date'],
      understood: true,
      confident: false,
    });
  });

  it('puts a chosen person in with the value the sentence gave them', () => {
    const { draft, pending } = parsed(result());
    const next = settlePending(draft, pending[0]!, RK);
    expect(next.split.exact).toEqual({ [ME]: '400.00', [RK]: '600.00' });
    expect(next.payers).toEqual({ mode: 'single', userId: AMIT });
  });

  it('keeps the split method when nobody in the split is settled yet', () => {
    const { draft } = parsed(
      result({ draft: { ...result().draft, splitMethod: 'shares', split: null } }),
    );
    expect(draft.split).toEqual({ ...emptySplit([]), method: 'shares' });
  });

  it('answers an unsettled payer without putting them in the split', () => {
    const { draft, pending } = parsed(
      result({
        draft: {
          ...result().draft,
          payerId: null,
          splitMethod: 'equal',
          split: { method: 'equal', participants: [ME, AMIT] },
        },
        resolutions: [{ name: 'Zara', role: 'payer', value: null, status: 'unknown' }],
      }),
    );
    expect(draft.payers).toEqual({ mode: 'single', userId: ME });
    expect(pending).toEqual([{ name: 'Zara', role: 'payer', joins: false, status: 'unknown' }]);
    const next = settlePending(draft, pending[0]!, RS);
    expect(next.payers).toEqual({ mode: 'single', userId: RS });
    expect(next.split.participants).toEqual([ME, AMIT]);
  });

  it('reads percentages and shares into the form’s own terms', () => {
    const withValue = (splitMethod: 'percent' | 'shares', value: string) =>
      parsed(
        result({
          draft: { ...result().draft, splitMethod, split: null },
          resolutions: [{ name: 'Zara', role: 'participant', value, status: 'unknown' }],
        }),
      ).pending[0]!.value;
    expect(withValue('percent', '33.5%')).toBe('33.5');
    expect(withValue('shares', '2')).toBe(2);
    expect(withValue('shares', 'two')).toBeUndefined();
    expect(withValue('percent', 'lots')).toBeUndefined();
  });

  it('is not used for a fallback: the rules’ reading stands', () => {
    expect(parsed(result({ path: 'fallback' })).understood).toBe(false);
  });
});
