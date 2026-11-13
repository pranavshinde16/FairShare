import type { Group, PaymentMethod, UpdateSettlement } from '@fairshare/contracts';
import { MAX_AMOUNT_MINOR, toDecimalString, tryParseMoney } from '@fairshare/core';
import { ArrowDownUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { cn } from '../../lib/utils';
import { formatAmount, formatAmountInput } from '../../lib/money';
import { localDate } from '../expenses/expense-form';
import { overpayment, overpaymentMessage, PAYMENT_METHODS, type Nets } from './payment';

/** What the form holds while someone types. */
export type SettleDraft = {
  fromUserId: string;
  toUserId: string;
  amountText: string;
  occurredOn: string;
  method: PaymentMethod;
  reference: string;
  note: string;
};

/** A stored settlement as a draft, for editing. */
export function draftFromSettlement(
  tx: {
    payers: [{ userId: string }];
    shares: [{ userId: string }];
    amount: number;
    occurredOn: string;
    paymentMethod: PaymentMethod;
    paymentRef: string | null;
    notes: string | null;
  },
  minorUnits: number,
): SettleDraft {
  return {
    fromUserId: tx.payers[0].userId,
    toUserId: tx.shares[0].userId,
    amountText: toDecimalString(tx.amount, minorUnits),
    occurredOn: tx.occurredOn,
    method: tx.paymentMethod,
    reference: tx.paymentRef ?? '',
    note: tx.notes ?? '',
  };
}

/** The draft as a request body, or the first problem with it. */
export function settlementBody(
  draft: SettleDraft,
  currency: string,
  minorUnits: number,
): { body: UpdateSettlement; problem: null } | { body: null; problem: string } {
  const amount = tryParseMoney(draft.amountText, minorUnits);
  if (draft.fromUserId === draft.toUserId) {
    return { body: null, problem: 'Choose two different people.' };
  }
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT_MINOR) {
    return {
      body: null,
      problem: draft.amountText.trim() ? 'Enter a valid amount.' : 'Enter the amount.',
    };
  }
  const reference = draft.reference.trim();
  const note = draft.note.trim();
  return {
    body: {
      fromUserId: draft.fromUserId,
      toUserId: draft.toUserId,
      amount,
      currency,
      occurredOn: draft.occurredOn,
      method: draft.method,
      ...(reference && { reference }),
      ...(note && { note }),
    },
    problem: null,
  };
}

/**
 * Settle payment (Blueprint 7.2): from, to (with a swap), the amount, the date, how it was paid,
 * an optional reference and note. Controlled, so the overpayment question can replace it on screen
 * and hand it back unchanged.
 */
export function SettleForm({
  group,
  meId,
  minorUnits,
  symbol,
  draft,
  onChange,
  nets,
  suggested,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  group: Group;
  meId: string;
  minorUnits: number;
  symbol: string;
  draft: SettleDraft;
  onChange: (draft: SettleDraft) => void;
  /** The group's balances to check an overpayment against (without this payment, when editing). */
  nets: Nets;
  /** The suggested payment between two people, if there is one. */
  suggested: (fromUserId: string, toUserId: string) => number | null;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (body: UpdateSettlement) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(draft.note !== '');
  const saveRef = useRef<HTMLButtonElement>(null);
  const set = (changes: Partial<SettleDraft>) => onChange({ ...draft, ...changes });
  const format = (amount: number) => formatAmount(amount, group.currency, minorUnits);

  // Active members, plus anyone this payment already names (an old payment with someone who left).
  const people = group.members.filter(
    (m) => m.leftAt === null || m.user.id === draft.fromUserId || m.user.id === draft.toUserId,
  );
  const label = (m: (typeof people)[number]) =>
    `${m.user.name}${m.user.id === meId ? ' (you)' : ''}${m.leftAt ? ' (left)' : ''}`;
  const nameOf = (userId: string) => people.find((m) => m.user.id === userId)?.user.name ?? '';

  const { body, problem } = settlementBody(draft, group.currency, minorUnits);
  const over = body && overpayment(nets, body.fromUserId, body.toUserId, body.amount);
  const overText =
    over &&
    overpaymentMessage(
      over,
      {
        id: over.side === 'payer' ? draft.fromUserId : draft.toUserId,
        meId,
        name: nameOf(over.side === 'payer' ? draft.fromUserId : draft.toUserId),
      },
      format,
    );
  const suggestion =
    draft.fromUserId !== draft.toUserId ? suggested(draft.fromUserId, draft.toUserId) : null;
  const future = draft.occurredOn > localDate();

  function submit() {
    // Ctrl/⌘+Enter reaches here without the (disabled) Save button.
    if (body && !busy && navigator.onLine) onSubmit(body);
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
      <div className="grid grid-cols-[1fr_auto] items-end gap-x-2 gap-y-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="settle-from">From</Label>
          <PersonSelect
            id="settle-from"
            value={draft.fromUserId}
            options={people.map((m) => [m.user.id, label(m)])}
            onChange={(fromUserId) => set({ fromUserId })}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Swap who paid and who was paid"
          className="row-span-2 self-center"
          onClick={() => set({ fromUserId: draft.toUserId, toUserId: draft.fromUserId })}
        >
          <ArrowDownUp aria-hidden />
        </Button>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settle-to">To</Label>
          <PersonSelect
            id="settle-to"
            value={draft.toUserId}
            options={people.map((m) => [m.user.id, label(m)])}
            onChange={(toUserId) => set({ toUserId })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settle-amount">Amount</Label>
        <div className="flex items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <span aria-hidden className="text-2xl text-muted-foreground">
            {symbol}
          </span>
          <input
            id="settle-amount"
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            aria-describedby="settle-amount-hint"
            value={draft.amountText}
            onChange={(event) => set({ amountText: event.target.value.replace(/[^\d.,]/g, '') })}
            onBlur={() => {
              if (body) {
                set({
                  amountText: formatAmountInput(body.amount, minorUnits),
                });
              }
            }}
            className="h-14 w-full bg-transparent text-3xl font-semibold tabular-nums outline-none"
          />
        </div>
        <div id="settle-amount-hint" className="flex flex-wrap items-center gap-x-2 text-sm">
          {overText && <span className="text-muted-foreground">{overText}</span>}
          {suggestion !== null && body?.amount !== suggestion && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => set({ amountText: toDecimalString(suggestion, minorUnits) })}
            >
              Use the suggested {format(suggestion)}
            </Button>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Method</legend>
        <div className="grid grid-cols-4 rounded-lg bg-muted p-1">
          {PAYMENT_METHODS.map(([method, text]) => (
            <button
              key={method}
              type="button"
              aria-pressed={draft.method === method}
              onClick={() => set({ method })}
              className={cn(
                'flex h-10 items-center justify-center rounded-md text-sm font-medium',
                draft.method === method ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {text}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Date</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['Today', localDate()],
            ['Yesterday', localDate(-1)],
          ].map(([text, value]) => (
            <Button
              key={text}
              type="button"
              size="sm"
              variant={draft.occurredOn === value ? 'default' : 'outline'}
              aria-pressed={draft.occurredOn === value}
              onClick={() => set({ occurredOn: value! })}
            >
              {text}
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="settle-reference">Reference (optional)</Label>
        <Input
          id="settle-reference"
          value={draft.reference}
          maxLength={100}
          autoComplete="off"
          placeholder="e.g. UPI transaction ID"
          onChange={(event) => set({ reference: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveRef.current?.focus();
            }
          }}
        />
      </div>

      {noteOpen ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="settle-note">Note</Label>
          <textarea
            id="settle-note"
            rows={2}
            maxLength={1000}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
            className="rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm"
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          className="self-start"
          onClick={() => setNoteOpen(true)}
        >
          Add a note
        </Button>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-card pt-2">
        {(error ?? (draft.amountText || draft.fromUserId === draft.toUserId ? problem : null)) && (
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

function PersonSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: [string, string][];
  onChange: (userId: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm"
    >
      {options.map(([userId, text]) => (
        <option key={userId} value={userId}>
          {text}
        </option>
      ))}
    </select>
  );
}
