import type { Group, Transaction, UpdateExpense } from '@fairshare/contracts';
import { formatMoney } from '@fairshare/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { readStored, writeStored } from '../../lib/storage';
import { cn } from '../../lib/utils';
import {
  draftFromExpense,
  evaluate,
  expenseBody,
  newDraft as buildNewDraft,
  toRemember,
  type ExpenseDraft,
  type Remembered,
} from './split-draft';
import { SplitSheet } from './split-sheet';

export type { ExpenseDraft } from './split-draft';

/** The person's local date, "YYYY-MM-DD" (occurredOn is a calendar day, not an instant). */
export function localDate(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A stored expense as a draft: every split reopens as it was entered (Blueprint 7.3 "Edit mode"). */
export function draftFromTransaction(
  tx: Extract<Transaction, { type: 'expense' }>,
  minorUnits: number,
): ExpenseDraft {
  return draftFromExpense({ ...tx, split: tx.splitInput }, minorUnits);
}

// The last payer and equal-split participants, per group, on this device (Blueprint 7.3).
const defaultsKey = (groupId: string) => `fairshare.expense-defaults.${groupId}`;

function storedDefaults(groupId: string): Remembered {
  try {
    const value = JSON.parse(readStored('local', defaultsKey(groupId)) ?? '{}') as unknown;
    if (typeof value !== 'object' || value === null) return {};
    const { payerId, participants } = value as Record<string, unknown>;
    return {
      ...(typeof payerId === 'string' && { payerId }),
      ...(Array.isArray(participants) &&
        participants.every((p) => typeof p === 'string') && {
          participants: participants,
        }),
    };
  } catch {
    return {};
  }
}

/** After a save: remember what this expense used, keeping what it didn't change. */
export function rememberDefaults(groupId: string, draft: ExpenseDraft) {
  writeStored(
    'local',
    defaultsKey(groupId),
    JSON.stringify({ ...storedDefaults(groupId), ...toRemember(draft) }),
  );
}

/** A new expense: the remembered payer and participants for this group, today. */
export function newDraft(group: Group, meId: string): ExpenseDraft {
  return buildNewDraft(group, meId, storedDefaults(group.id), localDate());
}

/**
 * The Add/Edit expense form (Blueprint 7.3): amount → description → Save, with the split behind
 * the summary chip. Every amount shown comes from core.computeShares seeded with the expense's ID,
 * exactly as the server computes it.
 */
export function ExpenseForm({
  id,
  group,
  meId,
  minorUnits,
  symbol,
  initial,
  submitLabel,
  busy = false,
  error = null,
  onSubmit,
}: {
  id: string;
  group: Group;
  meId: string;
  minorUnits: number;
  symbol: string;
  initial: ExpenseDraft;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (body: UpdateExpense, draft: ExpenseDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  // Anything but one payer and an equal split opens with the sheet showing, so it's never hidden.
  const [splitOpen, setSplitOpen] = useState(
    initial.payers.mode === 'multiple' || initial.split.method !== 'equal',
  );
  const [notesOpen, setNotesOpen] = useState(initial.notes !== '');
  const saveRef = useRef<HTMLButtonElement>(null);
  const set = (changes: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...changes }));

  const money = (amount: number) =>
    formatMoney(amount, minorUnits, Intl, { locale: navigator.language, currency: group.currency });
  const state = useMemo(
    () =>
      evaluate(draft, {
        seed: id,
        minorUnits,
        money: (amount) =>
          formatMoney(amount, minorUnits, Intl, {
            locale: navigator.language,
            currency: group.currency,
          }),
      }),
    [draft, id, minorUnits, group.currency],
  );
  const body = expenseBody(draft, state, group.currency);
  // In form order: the amount (evaluate puts its problem first), the description, then the split.
  const problem =
    state.amount === null
      ? state.problem
      : !draft.description.trim()
        ? 'Add a description.'
        : state.problem;

  const active = group.members.filter((m) => m.leftAt === null);
  const nameOf = (userId: string) =>
    userId === meId
      ? 'you'
      : (group.members.find((m) => m.user.id === userId)?.user.name ?? 'someone');
  const future = draft.occurredOn > localDate();

  function submit() {
    if (body && !busy) onSubmit(body, draft);
  }

  return (
    <form
      noValidate
      className="flex min-h-full flex-1 flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="expense-amount">Amount</Label>
        <div className="flex items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <span aria-hidden className="text-2xl text-muted-foreground">
            {symbol}
          </span>
          <input
            id="expense-amount"
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={draft.amountText}
            onChange={(event) => set({ amountText: event.target.value.replace(/[^\d.,]/g, '') })}
            onBlur={() => {
              if (state.amount !== null) {
                set({
                  amountText: formatMoney(state.amount, minorUnits, Intl, { locale: 'en-US' }),
                });
              }
            }}
            className="h-14 w-full bg-transparent text-3xl font-semibold tabular-nums outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="expense-description">Description</Label>
        <Input
          id="expense-description"
          value={draft.description}
          maxLength={120}
          placeholder="e.g. Dinner"
          onChange={(event) => set({ description: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveRef.current?.focus();
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={splitOpen}
          aria-controls="split-panel"
          onClick={() => setSplitOpen(!splitOpen)}
          className="flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-sm hover:bg-muted"
        >
          <span className="flex-1">
            <Summary
              draft={draft}
              state={state}
              active={active.length}
              nameOf={nameOf}
              money={money}
            />
          </span>
          {splitOpen ? (
            <ChevronUp aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
        </button>
        {/* The remembered participants, or a hand-picked few: one tap back to everyone. */}
        {draft.split.method === 'equal' &&
          draft.split.participants.length < active.length &&
          draft.split.participants.length > 0 && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="self-start"
              onClick={() =>
                set({ split: { ...draft.split, participants: active.map((m) => m.user.id) } })
              }
            >
              Split with everyone
            </Button>
          )}

        {splitOpen && (
          <SplitSheet
            group={group}
            meId={meId}
            draft={draft}
            state={state}
            seed={id}
            minorUnits={minorUnits}
            money={money}
            onChange={(changes) => set(changes)}
          />
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Date</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['Today', localDate()],
            ['Yesterday', localDate(-1)],
          ].map(([label, value]) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant={draft.occurredOn === value ? 'default' : 'outline'}
              aria-pressed={draft.occurredOn === value}
              onClick={() => set({ occurredOn: value! })}
            >
              {label}
            </Button>
          ))}
          <Input
            type="date"
            aria-label="Pick a date"
            className="h-9 w-auto"
            min="2000-01-01"
            value={draft.occurredOn}
            onChange={(event) => event.target.value && set({ occurredOn: event.target.value })}
          />
        </div>
        {future && <p className="text-sm text-muted-foreground">That date is in the future.</p>}
      </fieldset>

      {notesOpen ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-notes">Notes</Label>
          <textarea
            id="expense-notes"
            rows={3}
            maxLength={1000}
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm"
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          className="self-start"
          onClick={() => setNotesOpen(true)}
        >
          Add notes
        </Button>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-card pt-2">
        {/* One message at a time (Blueprint 7.3), once there's something to judge. */}
        {(error ?? (draft.amountText || draft.description ? problem : null)) && (
          <p
            role={error ? 'alert' : undefined}
            className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}
          >
            {error ?? problem}
          </p>
        )}
        <Button ref={saveRef} type="submit" size="lg" disabled={!body} loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** "Paid by you · Split equally between all 4 · ₹600.00 each". */
function Summary({
  draft,
  state,
  active,
  nameOf,
  money,
}: {
  draft: ExpenseDraft;
  state: ReturnType<typeof evaluate>;
  active: number;
  nameOf: (userId: string) => string;
  money: (amount: number) => string;
}) {
  const { payers, split } = draft;
  const paidBy =
    payers.mode === 'single'
      ? nameOf(payers.userId)
      : `${Object.keys(payers.amounts).length} people`;
  let how: React.ReactNode;
  if (split.method === 'equal') {
    const n = split.participants.length;
    how = (
      <>
        Split equally between <strong>{n === active ? `all ${n}` : `${n} of ${active}`}</strong>
      </>
    );
  } else {
    const label = { exact: 'exact amounts', percent: 'percentages', shares: 'shares' }[
      split.method
    ];
    how = (
      <>
        Split by <strong>{label}</strong>
      </>
    );
  }
  let each: string | null = null;
  if (split.method === 'equal' && state.shares && state.shares.length > 0) {
    const amounts = state.shares.map((s) => s.amount);
    const [low, high] = [Math.min(...amounts), Math.max(...amounts)];
    each = low === high ? `${money(low)} each` : `${money(low)}–${money(high)} each`;
  }
  return (
    <>
      Paid by <strong>{paidBy}</strong> · {how}
      {each && <span className="text-muted-foreground"> · {each}</span>}
    </>
  );
}
