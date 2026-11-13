import type { Group, PaymentMethod, UpdateSettlement } from '@fairshare/contracts';
import { MAX_AMOUNT_MINOR, tryParseMoney } from '@fairshare/core';
import { ArrowUpDown, ChevronDown, NotepadText } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { useRef, useState } from 'react';
import { AmountInput } from '../../components/ui/amount-input';
import { Button } from '../../components/ui/button';
import { DateQuickPick } from '../../components/ui/date-quick-pick';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { SegmentedControl } from '../../components/ui/segmented-control';
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
    amountText: formatAmountInput(tx.amount, minorUnits),
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
  onCancel,
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
  /** Desktop's Cancel beside the action (phones close with the header's ✕). */
  onCancel?: () => void;
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
      className="flex min-h-full flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settle-from">From</Label>
            <PersonSelect
              id="settle-from"
              value={draft.fromUserId}
              people={people}
              label={label}
              onChange={(fromUserId) => set({ fromUserId })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settle-to">To</Label>
            <PersonSelect
              id="settle-to"
              value={draft.toUserId}
              people={people}
              label={label}
              onChange={(toUserId) => set({ toUserId })}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Swap who paid and who was paid"
          className="mt-5 size-12 shadow-none"
          onClick={() => set({ fromUserId: draft.toUserId, toUserId: draft.fromUserId })}
        >
          <ArrowUpDown aria-hidden strokeWidth={1.9} />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settle-amount">Amount</Label>
        <AmountInput
          id="settle-amount"
          size="payment"
          symbol={symbol}
          autoFocus
          aria-describedby="settle-amount-hint"
          value={draft.amountText}
          onChange={(event) => set({ amountText: event.target.value.replace(/[^\d.,]/g, '') })}
          onBlur={() => {
            if (body) set({ amountText: formatAmountInput(body.amount, minorUnits) });
          }}
        />
        <div id="settle-amount-hint" className="flex flex-wrap items-center gap-x-2 text-sm">
          {overText && <span className="text-muted-foreground">{overText}</span>}
          {suggestion !== null && body?.amount !== suggestion && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => set({ amountText: formatAmountInput(suggestion, minorUnits) })}
            >
              Use the suggested {format(suggestion)}
            </Button>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-bold">Method</legend>
        <SegmentedControl
          segments={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))}
          value={draft.method}
          onChange={(method) => set({ method })}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-bold">Date</legend>
        <DateQuickPick
          value={draft.occurredOn}
          onChange={(occurredOn) => set({ occurredOn })}
          today={localDate()}
          yesterday={localDate(-1)}
        />
        {future && <p className="text-sm text-muted-foreground">That date is in the future.</p>}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settle-reference">
          Reference <span className="font-medium text-muted-foreground">(optional)</span>
        </Label>
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
            className="rounded-lg border bg-card px-3.5 py-2.5 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring sm:text-sm"
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="self-start px-1"
          onClick={() => setNoteOpen(true)}
        >
          <NotepadText aria-hidden strokeWidth={1.9} />
          Add a note
        </Button>
      )}

      {/* The bottom bar: full width on phones (m-record-payment), Cancel and the action on desktop. */}
      <div className="sticky bottom-0 -mx-4 mt-auto -mb-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] lg:mx-0 lg:mb-0 lg:flex-row lg:items-center lg:bg-card lg:px-0 lg:pb-0">
        {(error ?? (draft.amountText || draft.fromUserId === draft.toUserId ? problem : null)) && (
          <p
            role={error ? 'alert' : undefined}
            className={cn(
              'text-sm leading-5 lg:flex-1',
              error
                ? 'rounded-md bg-destructive-muted px-3 py-2 text-destructive'
                : 'text-muted-foreground',
            )}
          >
            {error ?? problem}
          </p>
        )}
        <div className="flex gap-2.5 lg:ml-auto">
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="hidden lg:inline-flex"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button
            ref={saveRef}
            type="submit"
            size="lg"
            className="flex-1 lg:h-12 lg:flex-none"
            disabled={!body}
            loading={busy}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Who paid or was paid: the browser's own select (keyboard, screen readers, the phone's picker),
 * dressed as the design's picker with the chosen person's avatar (m-record-payment).
 */
function PersonSelect({
  id,
  value,
  people,
  label,
  onChange,
}: {
  id: string;
  value: string;
  people: Group['members'];
  label: (member: Group['members'][number]) => string;
  onChange: (userId: string) => void;
}) {
  const chosen = people.find((m) => m.user.id === value)?.user;
  return (
    <div className="relative">
      {chosen && (
        <Avatar
          name={chosen.name}
          src={chosen.avatarUrl}
          seed={chosen.id}
          deleted={chosen.isDeleted}
          size={32}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
        />
      )}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 w-full min-w-0 appearance-none rounded-lg border bg-card pr-10 pl-[56px] text-base font-semibold outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring"
      >
        {people.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            {label(m)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.9}
      />
    </div>
  );
}
