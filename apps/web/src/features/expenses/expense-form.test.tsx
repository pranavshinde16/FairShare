// @vitest-environment jsdom
// Component tests of the Add/Edit expense form and its split sheet (Blueprint 11 Phase 11): each
// validation state, the shortcuts, and that what's sent is what was shown.

import type { Group, UpdateExpense } from '@fairshare/contracts';
import { computeShares } from '@fairshare/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpenseForm, type ExpenseDraft } from './expense-form';
import { draftFromExpense, emptySplit } from './split-draft';

afterEach(cleanup);

/** Renders inside a QueryClient: the name chips can add a member to the group. */
const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

// Plain DOM checks (no jest-dom): text with whitespace collapsed, an input's value, disabled.
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const value = (el: Element) => (el as HTMLInputElement).value;
const disabled = (el: Element) => (el as HTMLButtonElement).disabled;

const uid = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C] = [uid(1), uid(2), uid(3)];
const SEED = '01933333-0000-7000-8000-000000000099';
const member = (id: string, name: string) => ({
  user: { id, name, avatarUrl: null, isPlaceholder: false, isDeleted: false },
  role: 'member' as const,
  joinedAt: '2026-11-01T00:00:00.000Z',
  leftAt: null,
});
const group: Group = {
  id: uid(9),
  kind: 'group',
  name: 'Goa Trip',
  emoji: null,
  currency: 'INR',
  createdAt: '2026-11-01T00:00:00.000Z',
  members: [member(A, 'Asha'), member(B, 'Bilal'), member(C, 'Chitra')],
  myRole: 'owner',
};
const blank: ExpenseDraft = {
  amountText: '',
  description: '',
  occurredOn: '2026-11-10',
  notes: '',
  payers: { mode: 'single', userId: A },
  split: emptySplit([A, B, C]),
};

function setup(initial: ExpenseDraft = blank) {
  const onSubmit = vi.fn<(body: UpdateExpense, draft: ExpenseDraft) => void>();
  const user = userEvent.setup();
  render(
    <ExpenseForm
      id={SEED}
      group={group}
      meId={A}
      minorUnits={2}
      symbol="₹"
      initial={initial}
      submitLabel="Save"
      onSubmit={onSubmit}
    />,
  );
  const save = screen.getByRole('button', { name: 'Save' });
  const summary = screen.getByRole('button', { name: /^Paid by/ });
  const status = () => screen.getByRole('status');
  return { user, onSubmit, save, summary, status };
}

async function typeBasics(user: ReturnType<typeof userEvent.setup>, amount = '1200') {
  await user.type(screen.getByLabelText('Amount'), amount);
  await user.type(screen.getByLabelText('Description'), 'Dinner');
}

describe('the expense form', () => {
  it('saves an equal split with one tap once amount and description are in', async () => {
    const { user, save, summary, onSubmit } = setup();
    expect(disabled(save)).toBe(true);
    await typeBasics(user);
    expect(text(summary)).toContain('Paid by you · Split equally between all 3 · ₹400.00 each');
    expect(disabled(save)).toBe(false);
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0]).toEqual({
      description: 'Dinner',
      amount: 120_000,
      currency: 'INR',
      occurredOn: '2026-11-10',
      payers: [{ userId: A, amount: 120_000 }],
      split: { method: 'equal', participants: [A, B, C] },
    });
  });

  it('asks for one thing at a time: the amount, then the description, then the split', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Description'), 'Dinner');
    expect(screen.getByText('Enter the amount.')).toBeTruthy();
    await user.type(screen.getByLabelText('Amount'), '1200');
    await user.clear(screen.getByLabelText('Description'));
    expect(screen.getByText('Add a description.')).toBeTruthy();
    await user.type(screen.getByLabelText('Description'), 'Dinner');
    await user.click(screen.getByRole('button', { name: /^Paid by/ }));
    await user.click(screen.getByRole('button', { name: 'Nobody' }));
    expect(screen.getByText('Choose at least one person to split with.')).toBeTruthy();
  });

  it('shows the rounding, and offers everyone back after picking a few', async () => {
    const { user, summary } = setup();
    await typeBasics(user, '100');
    await user.click(summary);
    expect(screen.getByText('₹33.33 each, and ₹0.01 more for 1 person')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Chitra/ }));
    expect(text(summary)).toContain('Split equally between 2 of 3 · ₹50.00 each');
    await user.click(screen.getByRole('button', { name: 'Split with everyone' }));
    expect(text(summary)).toContain('Split equally between all 3');
  });
});

describe('the split sheet', () => {
  it('exact: starts from the current split, shows what is left, and assigns it', async () => {
    const { user, save, summary, status, onSubmit } = setup();
    await typeBasics(user);
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Exact amounts' }));
    expect(screen.getByRole('button', { name: 'Exact amounts' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(text(status())).toContain('All assigned');
    expect(text(summary)).toContain('Split by exact amounts');

    const asha = screen.getByLabelText('Asha (you)’s amount');
    await user.clear(asha);
    await user.type(asha, '300');
    expect(text(status())).toContain('₹100.00 left to assign');
    expect(screen.getByText('₹100.00 left to assign.')).toBeTruthy();
    expect(disabled(save)).toBe(true);

    await user.type(asha, '0'); // ₹3,000: over
    expect(text(status())).toContain('₹2,600.00 too much');

    await user.clear(asha);
    await user.type(asha, '200');
    await user.selectOptions(screen.getByLabelText('Assign remaining to'), 'Bilal');
    expect(value(screen.getByLabelText('Bilal’s amount'))).toBe('600.00');
    expect(text(status())).toContain('All assigned');
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0].split).toEqual({
      method: 'exact',
      amounts: [
        { userId: A, amount: 20_000 },
        { userId: B, amount: 60_000 },
        { userId: C, amount: 40_000 },
      ],
    });
  });

  it('percent: shows the ₹ beside each percentage, and fills the remainder', async () => {
    const { user, save, summary, status, onSubmit } = setup();
    await typeBasics(user);
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Percentages' }));
    for (const name of ['Asha (you)', 'Bilal', 'Chitra']) {
      await user.clear(screen.getByLabelText(`${name}’s percentage`));
    }
    await user.type(screen.getByLabelText('Asha (you)’s percentage'), '50');
    await user.type(screen.getByLabelText('Bilal’s percentage'), '30');
    expect(text(status())).toContain('20% left to assign');
    expect(disabled(save)).toBe(true);
    await user.type(screen.getByLabelText('Chitra’s percentage'), '33.333');
    expect(screen.getByText('Enter percentages like 33.33.')).toBeTruthy();
    await user.clear(screen.getByLabelText('Chitra’s percentage'));
    await user.selectOptions(screen.getByLabelText('Fill remainder'), 'Chitra');
    expect(value(screen.getByLabelText('Chitra’s percentage'))).toBe('20');
    expect(text(status())).toContain('All assigned');
    // ₹1,200 at 50/30/20, each shown beside its row.
    expect(screen.getByText('₹600.00')).toBeTruthy();
    expect(screen.getByText('₹360.00')).toBeTruthy();
    expect(screen.getByText('₹240.00')).toBeTruthy();
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0].split).toEqual({
      method: 'percent',
      basisPoints: [
        { userId: A, bp: 5000 },
        { userId: B, bp: 3000 },
        { userId: C, bp: 2000 },
      ],
    });
  });

  it('shares: steppers, 0 leaves someone out, and nobody at all is refused', async () => {
    const { user, save, summary, onSubmit } = setup();
    await typeBasics(user);
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Shares' }));
    await user.click(screen.getByRole('button', { name: 'More shares for Asha (you)' }));
    await user.click(screen.getByRole('button', { name: 'Fewer shares for Chitra' }));
    expect(value(screen.getByLabelText('Asha (you)’s shares'))).toBe('2');
    expect(screen.getByText('not in this one')).toBeTruthy();
    expect(screen.getByText('₹800.00')).toBeTruthy(); // 2 of 3 shares of ₹1,200
    await user.click(screen.getByRole('button', { name: 'Fewer shares for Bilal' }));
    await user.click(screen.getByRole('button', { name: 'Fewer shares for Asha (you)' }));
    await user.click(screen.getByRole('button', { name: 'Fewer shares for Asha (you)' }));
    expect(screen.getByText('Give at least one person a share.')).toBeTruthy();
    expect(disabled(save)).toBe(true);
    expect(disabled(screen.getByRole('button', { name: 'Fewer shares for Asha (you)' }))).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'More shares for Bilal' }));
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0].split).toEqual({
      method: 'shares',
      shares: [{ userId: B, shares: 1 }],
    });
  });

  it('several payers: what they paid must add up; “Split payment equally” does it', async () => {
    const { user, save, summary, onSubmit } = setup();
    await typeBasics(user, '3000');
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Several people paid' }));
    expect(value(screen.getByLabelText('What Asha (you) paid'))).toBe('3000.00');
    await user.click(screen.getByRole('checkbox', { name: 'Chitra paid' }));
    expect(text(summary)).toContain('Paid by 2 people');
    const sheet = screen.getByRole('group', { name: 'Paid by' });
    expect(text(within(sheet).getByRole('status'))).toContain('All paid');

    await user.clear(screen.getByLabelText('What Asha (you) paid'));
    await user.type(screen.getByLabelText('What Asha (you) paid'), '1000');
    expect(text(within(sheet).getByRole('status'))).toContain('₹2,000.00 left to assign');
    expect(screen.getByText('₹2,000.00 of what was paid is still to assign.')).toBeTruthy();
    expect(disabled(save)).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Split payment equally' }));
    expect(value(screen.getByLabelText('What Asha (you) paid'))).toBe('1500.00');
    expect(value(screen.getByLabelText('What Chitra paid'))).toBe('1500.00');
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0].payers).toEqual([
      { userId: A, amount: 150_000 },
      { userId: C, amount: 150_000 },
    ]);

    await user.click(screen.getByRole('button', { name: 'One person paid' }));
    expect(text(summary)).toContain('Paid by you');
  });

  it('sends exactly the shares it showed (same seed as the server)', async () => {
    const { user, save, onSubmit } = setup();
    await typeBasics(user, '100');
    await user.click(save);
    const [body] = onSubmit.mock.calls[0]!;
    const expected = computeShares(body.amount, body.split, SEED);
    await user.click(screen.getByRole('button', { name: /^Paid by/ }));
    for (const line of expected) {
      const name = group.members.find((m) => m.user.id === line.userId)!.user.name;
      const row = screen.getByRole('checkbox', { name: new RegExp(name) }).closest('label')!;
      expect(text(row)).toContain(`₹${(line.amount / 100).toFixed(2)}`);
    }
  });
});

describe('editing', () => {
  it('reopens a percent split with two payers exactly as entered, the sheet open', async () => {
    const initial = draftFromExpense(
      {
        amount: 120_000,
        description: 'Hotel',
        occurredOn: '2026-11-10',
        notes: null,
        payers: [
          { userId: A, amount: 100_000 },
          { userId: B, amount: 20_000 },
        ],
        split: {
          method: 'percent',
          basisPoints: [
            { userId: A, bp: 3333 },
            { userId: C, bp: 6667 },
          ],
        },
      },
      2,
    );
    const { user, save, summary, onSubmit } = setup(initial);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Percentages' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(value(screen.getByLabelText('Asha (you)’s percentage'))).toBe('33.33');
    expect(value(screen.getByLabelText('Bilal’s percentage'))).toBe('');
    expect(value(screen.getByLabelText('Chitra’s percentage'))).toBe('66.67');
    expect(value(screen.getByLabelText('What Bilal paid'))).toBe('200.00');
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      payers: [
        { userId: A, amount: 100_000 },
        { userId: B, amount: 20_000 },
      ],
      split: initial.split.method === 'percent' && {
        method: 'percent',
        basisPoints: [
          { userId: A, bp: 3333 },
          { userId: C, bp: 6667 },
        ],
      },
    });
  });
});

describe('typed entry (Blueprint 8)', () => {
  const D = uid(4);
  const two: Group = {
    ...group,
    // Two Bilals, neither named just "Bilal": a first name alone is ambiguous.
    members: [
      member(A, 'Asha'),
      member(B, 'Bilal Ahmed'),
      member(C, 'Chitra'),
      member(D, 'Bilal Khan'),
    ],
  };
  function entrySetup(text?: string) {
    const onSubmit = vi.fn<(body: UpdateExpense, draft: ExpenseDraft) => void>();
    const user = userEvent.setup();
    render(
      <ExpenseForm
        id={SEED}
        group={two}
        meId={A}
        minorUnits={2}
        symbol="₹"
        initial={blank}
        submitLabel="Save"
        entry={text === undefined ? {} : { text }}
        onSubmit={onSubmit}
      />,
    );
    return { user, onSubmit, save: screen.getByRole('button', { name: 'Save' }) };
  }

  it('fills the form from a sentence, and saves it in one more tap', async () => {
    const { user, onSubmit, save } = entrySetup();
    await user.type(screen.getByLabelText('Type it'), 'I paid 900 for dinner with Chitra{Enter}');
    expect(value(screen.getByLabelText('Amount'))).toBe('900.00');
    expect(value(screen.getByLabelText('Description'))).toBe('Dinner');
    expect(text(screen.getByRole('button', { name: /^Paid by/ }))).toContain(
      'Split equally between 2 of 4 · ₹450.00 each',
    );
    // What the sentence filled is marked until it's edited.
    expect(screen.getByLabelText('Description').className).toContain('ring-primary/40');
    await user.type(screen.getByLabelText('Description'), ' out');
    expect(screen.getByLabelText('Description').className).not.toContain('ring-primary/40');
    // Enter in the bar filled the form; it didn't save it.
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      amount: 90_000,
      description: 'Dinner out',
      payers: [{ userId: A, amount: 90_000 }],
      split: { method: 'equal', participants: [A, C] },
    });
  });

  it('asks which Bilal, and waits for the answer before saving', async () => {
    const { user, onSubmit, save } = entrySetup();
    await user.type(screen.getByLabelText('Type it'), 'taxi 600 with Bilal');
    await user.click(screen.getByRole('button', { name: 'Fill' }));
    const chip = screen.getByRole('group', { name: 'Which Bilal?' });
    expect(disabled(save)).toBe(true);
    expect(screen.getByText('Answer the questions about names above to save.')).toBeTruthy();
    await user.click(within(chip).getByRole('button', { name: 'Bilal Khan' }));
    expect(screen.queryByRole('group', { name: 'Which Bilal?' })).toBeNull();
    await user.click(save);
    expect(onSubmit.mock.calls[0]![0].split).toEqual({ method: 'equal', participants: [A, D] });
  });

  it('offers to remove a name that isn’t in the group', async () => {
    const { user, save } = entrySetup();
    await user.type(screen.getByLabelText('Type it'), 'taxi 600 with Zara and Chitra{Enter}');
    const chip = screen.getByRole('group', { name: 'Zara isn’t in the group' });
    expect(text(chip)).toContain('Zara isn’t in Goa Trip.');
    expect(within(chip).getByRole('button', { name: 'Add as new member' })).toBeTruthy();
    await user.click(within(chip).getByRole('button', { name: 'Remove' }));
    expect(disabled(save)).toBe(false);
  });

  it('says so when it can’t follow the sentence, keeping it as the description', () => {
    entrySetup('dinner ka 2400 maine diya');
    expect(screen.getByText('Couldn’t fully understand. Please check the details.')).toBeTruthy();
    expect(value(screen.getByLabelText('Amount'))).toBe('2,400.00');
    expect(value(screen.getByLabelText('Description'))).toBe('dinner ka 2400 maine diya');
  });

  it('a new sentence replaces what the last one filled, not what was typed by hand', async () => {
    const { user } = entrySetup();
    const bar = screen.getByLabelText('Type it');
    await user.type(bar, 'dinner 900 with Chitra yesterday{Enter}');
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '950');
    await user.clear(bar);
    await user.type(bar, 'lunch with Bilal Khan{Enter}');
    // By hand: kept. From the last sentence: gone (the date is today again, Chitra is out).
    expect(value(screen.getByLabelText('Amount'))).toBe('950.00');
    expect(value(screen.getByLabelText('Description'))).toBe('lunch with Bilal Khan');
    expect(value(screen.getByLabelText('Pick a date'))).toBe('2026-11-10');
    expect(text(screen.getByRole('button', { name: /^Paid by/ }))).toContain(
      'Split equally between 2 of 4',
    );
  });

  it('reads a sentence handed over from Home as it opens', () => {
    entrySetup('Bilal Khan paid 300 for snacks');
    expect(value(screen.getByLabelText('Type it'))).toBe('Bilal Khan paid 300 for snacks');
    expect(text(screen.getByRole('button', { name: /^Paid by/ }))).toContain('Paid by Bilal Khan');
    expect(screen.queryByText('Couldn’t fully understand. Please check the details.')).toBeNull();
  });
});
