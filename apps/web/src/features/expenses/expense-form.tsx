import type { Group, Transaction, UpdateExpense } from '@fairshare/contracts';
import {
  computeShares,
  formatMoney,
  MAX_AMOUNT_MINOR,
  toDecimalString,
  tryParseMoney,
} from '@fairshare/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { readStored, writeStored } from '../../lib/storage';
import { cn } from '../../lib/utils';

/** What the form holds while someone types. */
export type ExpenseDraft = {
  amountText: string;
  description: string;
  payerId: string;
  participants: string[];
  occurredOn: string;
  notes: string;
};

/** The person's local date, "YYYY-MM-DD" (occurredOn is a calendar day, not an instant). */
export function localDate(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Whether the Phase 7 editor can show an expense: one payer and an equal split. Other splits
 * (made through the API, or by later editors) open read-only until the full split sheet arrives.
 */
export function isEditableHere(tx: Transaction): boolean {
  return tx.type === 'expense' && tx.payers.length === 1 && tx.splitInput?.method === 'equal';
}

export function draftFromTransaction(tx: Transaction, minorUnits: number): ExpenseDraft {
  return {
    amountText: toDecimalString(tx.amount, minorUnits),
    description: tx.description,
    payerId: tx.payers[0].userId,
    participants:
      tx.type === 'expense' && tx.splitInput?.method === 'equal'
        ? tx.splitInput.participants
        : tx.shares.map((s) => s.userId),
    occurredOn: tx.occurredOn,
    notes: tx.notes ?? '',
  };
}

// The last payer and participants, per group, on this device (Blueprint 7.3 "smart defaults").
const defaultsKey = (groupId: string) => `fairshare.expense-defaults.${groupId}`;

function storedDefaults(groupId: string): { payerId?: string; participants?: string[] } {
  try {
    return JSON.parse(readStored('local', defaultsKey(groupId)) ?? '{}') as {
      payerId?: string;
      participants?: string[];
    };
  } catch {
    return {};
  }
}

export function rememberDefaults(groupId: string, draft: ExpenseDraft) {
  writeStored(
    'local',
    defaultsKey(groupId),
    JSON.stringify({ payerId: draft.payerId, participants: draft.participants }),
  );
}

/** A new expense's starting point: me (or the last payer) paying, split between everyone. */
export function newDraft(group: Group, meId: string): ExpenseDraft {
  const active = group.members.filter((m) => m.leftAt === null).map((m) => m.user.id);
  const saved = storedDefaults(group.id);
  const savedParticipants = saved.participants?.filter((id) => active.includes(id)) ?? [];
  return {
    amountText: '',
    description: '',
    payerId: saved.payerId && active.includes(saved.payerId) ? saved.payerId : meId,
    participants: savedParticipants.length > 0 ? savedParticipants : active,
    occurredOn: localDate(),
    notes: '',
  };
}

/**
 * The Add/Edit expense form (Blueprint 7.3), for an equal split with one payer. Every amount shown
 * comes from core.computeShares seeded with the expense's ID, exactly as the server computes it.
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
  const [splitOpen, setSplitOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(initial.notes !== '');
  const saveRef = useRef<HTMLButtonElement>(null);
  const set = (changes: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...changes }));

  const active = group.members.filter((m) => m.leftAt === null);
  const nameOf = (userId: string) =>
    userId === meId
      ? 'you'
      : (group.members.find((m) => m.user.id === userId)?.user.name ?? 'someone');
  const format = (amount: number) =>
    formatMoney(amount, minorUnits, Intl, { locale: navigator.language, currency: group.currency });

  const amount = tryParseMoney(draft.amountText, minorUnits);
  const amountValid = amount !== null && amount > 0 && amount <= MAX_AMOUNT_MINOR;
  const shares = useMemo(() => {
    if (!amountValid || draft.participants.length === 0) return null;
    try {
      return computeShares(amount, { method: 'equal', participants: draft.participants }, id);
    } catch {
      return null;
    }
  }, [amount, amountValid, draft.participants, id]);

  const problems = [
    !amountValid && (draft.amountText.trim() ? 'Enter a valid amount.' : 'Enter the amount.'),
    !draft.description.trim() && 'Add a description.',
    draft.participants.length === 0 && 'Choose at least one person to split with.',
  ].filter(Boolean) as string[];
  const valid = problems.length === 0 && shares !== null;
  const future = draft.occurredOn > localDate();

  const everyone = draft.participants.length === active.length;
  const eachText =
    shares && shares.length > 0
      ? (() => {
          const amounts = shares.map((s) => s.amount);
          const [low, high] = [Math.min(...amounts), Math.max(...amounts)];
          return low === high ? `${format(low)} each` : `${format(low)}–${format(high)} each`;
        })()
      : null;

  function submit() {
    if (!valid || busy) return;
    const notes = draft.notes.trim();
    onSubmit(
      {
        description: draft.description.trim(),
        amount: amount!,
        currency: group.currency,
        occurredOn: draft.occurredOn,
        ...(notes && { notes }),
        payers: [{ userId: draft.payerId, amount: amount! }],
        split: { method: 'equal', participants: draft.participants },
      },
      draft,
    );
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
              if (amountValid) {
                set({
                  amountText: formatMoney(amount, minorUnits, Intl, { locale: 'en-US' }),
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
            Paid by <strong>{nameOf(draft.payerId)}</strong> · Split equally between{' '}
            <strong>
              {everyone
                ? `all ${active.length}`
                : `${draft.participants.length} of ${active.length}`}
            </strong>
            {eachText && <span className="text-muted-foreground"> · {eachText}</span>}
          </span>
          {splitOpen ? (
            <ChevronUp aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
        </button>

        {splitOpen && (
          <div id="split-panel" className="flex flex-col gap-4 rounded-lg border p-3">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">Paid by</legend>
              {active.map((m) => (
                <label
                  key={m.user.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted"
                >
                  <input
                    type="radio"
                    name="payer"
                    checked={draft.payerId === m.user.id}
                    onChange={() => set({ payerId: m.user.id })}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                  <span className="text-sm">
                    {m.user.id === meId ? `${m.user.name} (you)` : m.user.name}
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium">
                Split equally between
              </legend>
              <div className="mb-1 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set({ participants: active.map((m) => m.user.id) })}
                >
                  Everyone
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => set({ participants: [] })}
                >
                  Nobody
                </Button>
              </div>
              {active.map((m) => {
                const checked = draft.participants.includes(m.user.id);
                const share = shares?.find((s) => s.userId === m.user.id);
                return (
                  <label
                    key={m.user.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        set({
                          participants: checked
                            ? draft.participants.filter((p) => p !== m.user.id)
                            : [...draft.participants, m.user.id],
                        })
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                    <span className="flex-1 text-sm">
                      {m.user.id === meId ? `${m.user.name} (you)` : m.user.name}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {share ? format(share.amount) : ''}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
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
        {(error ?? (draft.amountText || draft.description ? problems[0] : null)) && (
          <p
            role={error ? 'alert' : undefined}
            className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}
          >
            {error ?? problems[0]}
          </p>
        )}
        <Button ref={saveRef} type="submit" size="lg" disabled={!valid} loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
