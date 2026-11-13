import type { Group } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { emptySplit, type ExpenseDraft } from '../expenses/split-draft';
import { applyEntry, settlePending } from './entry';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [ME, RS, RK, AMIT, LEFT] = [id(1), id(2), id(3), id(4), id(5)];
const member = (userId: string, name: string, leftAt: string | null = null) => ({
  user: { id: userId, name, avatarUrl: null, isPlaceholder: false },
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
      { name: 'Rahul', role: 'participant', status: 'ambiguous', candidates: [RS, RK] },
      { name: 'Zara', role: 'participant', status: 'unknown' },
    ]);
    // Only the settled people are in so far.
    expect(result.draft.split.participants).toEqual([ME]);
  });

  it('holds an unsettled payer as a chip, with me paying meanwhile', () => {
    const result = apply('paid by Rahul 1500 for petrol');
    expect(result.pending).toEqual([
      { name: 'Rahul', role: 'payer', status: 'ambiguous', candidates: [RS, RK] },
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

  it('ignores members who left', () => {
    expect(apply('taxi 600 with Dev').pending).toEqual([
      { name: 'Dev', role: 'participant', status: 'unknown' },
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
