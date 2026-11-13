import type { Group, Transaction, UpdateExpense } from '@fairshare/contracts';
import { ArrowLeft, ChevronDown, NotebookPen, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { DateQuickPick } from '../../components/ui/date-quick-pick';
import { Label } from '../../components/ui/label';
import { formatAmount, formatAmountInput, formatWholeAmount, plural } from '../../lib/money';
import { readStored, writeStored } from '../../lib/storage';
import { cn } from '../../lib/utils';
import { applyEntry, settlePending, type Filled, type Pending } from '../ai/entry';
import { ResolutionChips } from '../ai/resolution-chips';
import {
  canTakePart,
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
  entry,
  onSubmit,
  onCancel,
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
  /**
   * New expenses: the "Type it" bar (Blueprint 7.3, 8). `text`: a sentence typed elsewhere (Home),
   * read into the form as it opens.
   */
  entry?: { text?: string };
  onSubmit: (body: UpdateExpense, draft: ExpenseDraft) => void;
  /** Desktop's Cancel beside Save (phones close with the header's ✕). */
  onCancel?: () => void;
}) {
  const read = (text: string, from: ExpenseDraft) =>
    applyEntry(text, from, { group, meId, minorUnits, today: localDate() });
  const [opening] = useState(() => (entry?.text ? read(entry.text, initial) : null));
  const [draft, setDraft] = useState(opening?.draft ?? initial);
  const [entryText, setEntryText] = useState(entry?.text ?? '');
  const [pending, setPending] = useState<Pending[]>(opening?.pending ?? []);
  const [filled, setFilled] = useState<Filled[]>(opening?.filled ?? []);
  const [understood, setUnderstood] = useState(opening?.understood ?? true);
  // Anything but one payer and an equal split opens with the sheet showing, so it's never hidden.
  const [splitOpen, setSplitOpen] = useState(
    initial.payers.mode === 'multiple' || initial.split.method !== 'equal',
  );
  const [notesOpen, setNotesOpen] = useState(initial.notes !== '');
  const saveRef = useRef<HTMLButtonElement>(null);
  const headerSaveRef = useRef<HTMLButtonElement>(null);
  /** A change by hand: what the sentence filled stops being highlighted once it's edited. */
  const set = (changes: Partial<ExpenseDraft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    const touched: Filled[] = [
      ...(changes.amountText !== undefined ? (['amount'] as const) : []),
      ...(changes.description !== undefined ? (['description'] as const) : []),
      ...(changes.occurredOn !== undefined ? (['date'] as const) : []),
      ...(changes.split !== undefined || changes.payers !== undefined ? (['split'] as const) : []),
    ];
    if (touched.length) setFilled((f) => f.filter((x) => !touched.includes(x)));
  };
  const highlight = (field: Filled) =>
    filled.includes(field) && 'bg-accent/60 ring-1 ring-primary/40';

  function fill() {
    const text = entryText.trim();
    if (!text) return;
    // A new sentence replaces what the last one filled (fields still as it left them); anything
    // changed by hand stays.
    const base: ExpenseDraft = {
      ...draft,
      ...(filled.includes('amount') && { amountText: initial.amountText }),
      ...(filled.includes('description') && { description: initial.description }),
      ...(filled.includes('date') && { occurredOn: initial.occurredOn }),
      ...(filled.includes('split') && { payers: initial.payers, split: initial.split }),
    };
    const result = read(text, base);
    setDraft(result.draft);
    setPending(result.pending);
    setFilled(result.filled);
    setUnderstood(result.understood);
  }

  const money = (amount: number) => formatAmount(amount, group.currency, minorUnits);
  const state = useMemo(
    () =>
      evaluate(draft, {
        seed: id,
        minorUnits,
        money: (amount) => formatAmount(amount, group.currency, minorUnits),
      }),
    [draft, id, minorUnits, group.currency],
  );
  // Save waits until every name from a typed entry is settled (Blueprint 8.7).
  const body = pending.length === 0 ? expenseBody(draft, state, group.currency) : null;
  // In form order: the amount (evaluate puts its problem first), the description, then the split.
  const problem =
    pending.length > 0
      ? 'Answer the questions about names above to save.'
      : state.amount === null
        ? state.problem
        : !draft.description.trim()
          ? 'Add a description.'
          : state.problem;

  const active = group.members.filter(canTakePart);
  const nameOf = (userId: string) =>
    userId === meId
      ? 'you'
      : (group.members.find((m) => m.user.id === userId)?.user.name ?? 'someone');
  const future = draft.occurredOn > localDate();

  function submit() {
    // Ctrl/⌘+Enter reaches here without the (disabled) Save button.
    if (body && !busy && navigator.onLine) onSubmit(body, draft);
  }

  const friend =
    group.kind === 'direct' ? group.members.find((m) => m.user.id !== meId)?.user : undefined;
  const shown = error ?? (draft.amountText || draft.description || pending.length ? problem : null);
  // Enter in the description goes to Save: the header's on phones, the footer's on desktop.
  const focusSave = () =>
    [headerSaveRef.current, saveRef.current].find((b) => b && b.offsetParent !== null)?.focus();

  return (
    <form
      noValidate
      className="flex min-h-full flex-1 flex-col gap-[18px] lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* Phones: Save sits at the right of the full-screen header (DESIGN_SPEC §2). */}
      <Button
        ref={headerSaveRef}
        type="submit"
        variant="ghost"
        disabled={!body}
        loading={busy}
        className="absolute top-2 right-2 z-10 px-3 text-base font-extrabold lg:hidden"
      >
        {submitLabel}
      </Button>

      {/* ---- The expense (phones: hidden while the split editor is open) */}
      <div className={cn('flex flex-col gap-[18px]', splitOpen && 'hidden lg:flex')}>
        <div className="-mx-4 -mt-4 flex flex-wrap items-center gap-2.5 border-b px-4 py-2.5 text-[15px] lg:mx-0 lg:mt-0 lg:border-0 lg:p-0">
          <span className="text-muted-foreground">
            With <b className="font-bold text-foreground">you</b> and:
          </span>
          <span className="inline-flex h-9 items-center gap-2 rounded-full border bg-card pr-3 pl-1 text-sm font-bold">
            {friend ? (
              <Avatar
                name={friend.name}
                src={friend.avatarUrl}
                seed={friend.id}
                deleted={friend.isDeleted}
                size={24}
                className="size-7"
              />
            ) : (
              <GroupTile
                emoji={group.emoji}
                name={group.name ?? ''}
                seed={group.id}
                size={32}
                className="size-7 rounded-[8px] text-sm"
              />
            )}
            {friend ? friend.name : group.name}
          </span>
        </div>

        {entry && (
          <div className="flex flex-col gap-2">
            <div className="flex h-[50px] items-center gap-2 rounded-lg border bg-card pr-1 pl-3.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-focus-ring">
              <Sparkles
                aria-hidden
                className="size-[18px] shrink-0 text-primary"
                strokeWidth={1.9}
              />
              <input
                aria-label="Type it"
                autoComplete="off"
                placeholder="Type it: ‘Dinner 2400 with Rahul & Amit’"
                value={entryText}
                onChange={(event) => setEntryText(event.target.value)}
                onKeyDown={(event) => {
                  // Enter fills the form; it mustn't save it.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    fill();
                  }
                }}
                className="h-full min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground sm:text-sm"
              />
              <Button
                type="button"
                size="sm"
                variant="tint"
                className="h-10 rounded-[10px]"
                disabled={!entryText.trim()}
                onClick={fill}
              >
                Fill
              </Button>
            </div>
            {!understood && (
              <p role="status" className="text-sm leading-5 text-muted-foreground">
                Couldn’t fully understand. Please check the details.
              </p>
            )}
            <ResolutionChips
              group={group}
              pending={pending}
              onSettle={(item, userId) => {
                setDraft((d) => settlePending(d, item, userId));
                setPending((list) => list.filter((p) => p !== item));
              }}
              onRemove={(item) => setPending((list) => list.filter((p) => p !== item))}
            />
          </div>
        )}

        <div className="flex flex-col">
          <label htmlFor="expense-description" className="text-xs font-bold text-muted-foreground">
            Description
          </label>
          <input
            id="expense-description"
            value={draft.description}
            maxLength={120}
            autoComplete="off"
            placeholder="e.g. Dinner"
            onChange={(event) => set({ description: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                focusSave();
              }
            }}
            className={cn(
              'h-[42px] w-full rounded-t-md border-b-2 bg-transparent text-[21px] font-bold outline-none placeholder:font-semibold placeholder:text-muted-foreground/70 focus:border-primary',
              highlight('description'),
            )}
          />
        </div>

        <div className="flex items-end gap-3.5">
          <span
            aria-hidden
            className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl font-extrabold"
          >
            {symbol}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <label htmlFor="expense-amount" className="text-xs font-bold text-muted-foreground">
              Amount
            </label>
            <input
              id="expense-amount"
              data-autofocus=""
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={draft.amountText}
              onChange={(event) => set({ amountText: event.target.value.replace(/[^\d.,]/g, '') })}
              onBlur={() => {
                if (state.amount !== null) {
                  set({ amountText: formatAmountInput(state.amount, minorUnits) });
                }
              }}
              className={cn(
                'h-[52px] w-full rounded-t-md border-b-2 bg-transparent text-[38px] font-extrabold tracking-[-0.03em] tabular-nums outline-none placeholder:text-muted-foreground/50 focus:border-primary',
                highlight('amount'),
              )}
            />
          </div>
        </div>

        <div className={cn('flex flex-col items-center gap-1 rounded-md', highlight('split'))}>
          <button
            type="button"
            aria-expanded={splitOpen}
            aria-controls="split-panel"
            onClick={() => setSplitOpen(true)}
            className="rounded-md px-1 text-center text-base leading-[44px] outline-none focus-visible:ring-3 focus-visible:ring-focus-ring lg:cursor-default"
          >
            <Sentence draft={draft} nameOf={nameOf} />
          </button>
          {/* The remembered participants, or a hand-picked few: one tap back to everyone. */}
          {draft.split.method === 'equal' &&
            draft.split.participants.length < active.length &&
            draft.split.participants.length > 0 && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() =>
                  set({ split: { ...draft.split, participants: active.map((m) => m.user.id) } })
                }
              >
                Split with everyone
              </Button>
            )}
        </div>

        <PeopleCard
          group={group}
          meId={meId}
          draft={draft}
          state={state}
          active={active.length}
          money={money}
          currency={group.currency}
          minorUnits={minorUnits}
        />

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] font-bold">Date</legend>
          <DateQuickPick
            value={draft.occurredOn}
            onChange={(occurredOn) => set({ occurredOn })}
            today={localDate()}
            yesterday={localDate(-1)}
            className={cn('rounded-md', highlight('date'))}
          />
          {future && (
            <p className="text-[13px] leading-5 text-muted-foreground">
              That date is in the future.
            </p>
          )}
        </fieldset>

        {notesOpen ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-notes">Notes</Label>
            <textarea
              id="expense-notes"
              rows={3}
              maxLength={1000}
              value={draft.notes}
              onChange={(event) => set({ notes: event.target.value })}
              className="rounded-lg border bg-card px-3.5 py-2.5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring sm:text-sm"
            />
          </div>
        ) : (
          <Button
            type="button"
            variant="soft"
            size="sm"
            className="self-start"
            onClick={() => setNotesOpen(true)}
          >
            <NotebookPen aria-hidden strokeWidth={1.9} />
            Add notes
          </Button>
        )}
      </div>

      {/* ---- Paid by & split (phones: its own view, opened from the sentence; desktop: the right
          half, always shown) */}
      <div
        className={cn(
          'flex flex-col gap-3.5 lg:rounded-xl lg:border lg:bg-muted/40 lg:p-4',
          !splitOpen && 'hidden lg:flex',
        )}
      >
        <div className="-mx-4 -mt-4 flex items-center gap-1 border-b px-2 py-1.5 lg:hidden">
          <Button
            type="button"
            variant="plain"
            size="icon"
            className="rounded-full"
            aria-label="Back to expense"
            onClick={() => setSplitOpen(false)}
          >
            <ArrowLeft aria-hidden className="size-5" strokeWidth={1.9} />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[15px] font-extrabold">Paid by &amp; split</p>
            <p className="truncate text-xs text-muted-foreground">
              {[draft.description.trim(), state.amount !== null && money(state.amount)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="px-3 text-base font-extrabold"
            onClick={() => setSplitOpen(false)}
          >
            Done
          </Button>
        </div>
        {/* Phones: what the editor adds up to, as you change it. */}
        <button
          type="button"
          aria-expanded={splitOpen}
          aria-controls="split-panel"
          onClick={() => setSplitOpen(false)}
          className="self-center rounded-md px-1 text-center text-base leading-[44px] outline-none focus-visible:ring-3 focus-visible:ring-focus-ring lg:hidden"
        >
          <Sentence draft={draft} nameOf={nameOf} />
        </button>
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
      </div>

      {/* ---- The one message (form order), and desktop's Cancel / Save */}
      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-card pt-2 lg:col-span-2 lg:flex-row lg:items-center lg:gap-3 lg:border-t lg:pt-4">
        {shown && (
          <p
            role={error ? 'alert' : undefined}
            className={cn(
              'text-sm leading-5 lg:flex-1',
              error
                ? 'rounded-md bg-destructive-muted px-3 py-2 text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {shown}
          </p>
        )}
        <div className="hidden gap-2.5 lg:ml-auto lg:flex">
          {onCancel && (
            <Button type="button" variant="secondary" size="md" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button ref={saveRef} type="submit" size="md" disabled={!body} loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** "Paid by you and split equally" (DESIGN_SPEC §5 m-add-expense), the editor's way in. */
function Sentence({ draft, nameOf }: { draft: ExpenseDraft; nameOf: (userId: string) => string }) {
  const { payers, split } = draft;
  const paidBy =
    payers.mode === 'single'
      ? nameOf(payers.userId)
      : plural(Object.keys(payers.amounts).length, 'person', 'people');
  const how = {
    equal: 'equally',
    exact: 'by exact amounts',
    percent: 'by percentages',
    shares: 'by shares',
  }[split.method];
  const pill =
    'mx-0.5 inline-flex h-9 items-center gap-1 rounded-full bg-accent px-3.5 align-middle text-[15px] font-bold text-accent-foreground';
  return (
    <>
      Paid by{' '}
      <span className={pill}>
        {paidBy}
        <ChevronDown aria-hidden className="size-4" strokeWidth={1.9} />
      </span>{' '}
      and split{' '}
      <span className={pill}>
        {how}
        <ChevronDown aria-hidden className="size-4" strokeWidth={1.9} />
      </span>
    </>
  );
}

/**
 * Who's in and what each pays (m-add-expense): "4 people · ₹750.00 / person", then each person's
 * tile with their share in whole units (§3's one exception). Before an amount: "Enter an amount to
 * see each share".
 */
function PeopleCard({
  group,
  meId,
  draft,
  state,
  active,
  money,
  currency,
  minorUnits,
}: {
  group: Group;
  meId: string;
  draft: ExpenseDraft;
  state: ReturnType<typeof evaluate>;
  active: number;
  money: (amount: number) => string;
  currency: string;
  minorUnits: number;
}) {
  const { split } = draft;
  const ids =
    split.method === 'equal'
      ? split.participants
      : (state.shares?.map((s) => s.userId) ?? split.participants);
  const shareOf = (userId: string) => state.shares?.find((s) => s.userId === userId)?.amount;
  const count = ids.length;
  const amounts = state.shares?.map((s) => s.amount) ?? [];
  let rate: string | null = null;
  if (state.amount === null) rate = 'Enter an amount to see each share';
  else if (split.method === 'equal' && amounts.length > 0) {
    const [low, high] = [Math.min(...amounts), Math.max(...amounts)];
    rate = `${low === high ? money(low) : `${money(low)}–${money(high)}`} / person`;
  } else if (split.method !== 'equal') {
    rate = { exact: 'by exact amounts', percent: 'by percentages', shares: 'by shares' }[
      split.method
    ];
  }
  if (count === 0) return null;
  return (
    <section
      aria-label="Each person’s share"
      className="rounded-xl border bg-card p-3.5 shadow-card"
    >
      <p className="mb-3 flex justify-between gap-2 text-[13px] text-muted-foreground">
        <span>
          {split.method === 'equal' && count < active
            ? `${count} of ${plural(active, 'person', 'people')}`
            : plural(count, 'person', 'people')}
        </span>
        {rate && (
          <span
            className={cn(
              'text-right',
              state.amount !== null && 'font-extrabold text-foreground tabular-nums',
            )}
          >
            {rate}
          </span>
        )}
      </p>
      <ul className="grid grid-cols-4 gap-2">
        {ids.map((userId) => {
          const user = group.members.find((m) => m.user.id === userId)?.user;
          const share = shareOf(userId);
          return (
            <li key={userId} className="flex min-w-0 flex-col items-center gap-1">
              <Avatar
                name={user?.name ?? '?'}
                src={user?.avatarUrl}
                seed={userId}
                deleted={user?.isDeleted}
              />
              <span className="max-w-full truncate text-xs font-semibold">
                {userId === meId ? 'You' : (user?.name.split(' ')[0] ?? 'Someone')}
              </span>
              <span className="text-xs font-extrabold tabular-nums">
                {share !== undefined && state.amount !== null
                  ? formatWholeAmount(share, currency, minorUnits)
                  : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
