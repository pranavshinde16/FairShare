import type { Group, UpdateSettlement } from '@fairshare/contracts';
import { formatMoney, toDecimalString } from '@fairshare/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { afterTransactionChange } from '../../lib/invalidation';
import { toast } from '../../lib/toast';
import { balancesQuery } from '../balances/queries';
import { localDate } from '../expenses/expense-form';
import { groupQuery } from '../groups/queries';
import { groupTitle } from '../groups/title';
import { currenciesQuery, meQuery } from '../profile/queries';
import {
  defaultMethod,
  defaultPair,
  overpayment,
  overpaymentMessage,
  paymentSentence,
  suggestedAmount,
  type Nets,
} from './payment';
import { SettleForm, type SettleDraft } from './settle-form';

/**
 * The settle form in its dialog, with the overpayment question (Blueprint 4.8: "This is ₹200 more
 * than Rahul owes. Record anyway?"). The question replaces the form on screen and hands it back
 * unchanged on "Change amount".
 */
export function SettleDialog({
  open = true,
  title,
  description,
  group,
  meId,
  minorUnits,
  symbol,
  initial,
  nets,
  suggested,
  submitLabel,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  open?: boolean;
  title: string;
  description?: ReactNode;
  group: Group;
  meId: string;
  minorUnits: number;
  symbol: string;
  initial: SettleDraft;
  nets: Nets;
  suggested: (fromUserId: string, toUserId: string) => number | null;
  submitLabel: string;
  confirmLabel: string;
  /** Saves; a rejection is shown in the form. */
  onSubmit: (body: UpdateSettlement) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [question, setQuestion] = useState<{ body: UpdateSettlement; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (amount: number) =>
    formatMoney(amount, minorUnits, Intl, { locale: navigator.language, currency: group.currency });
  const nameOf = (userId: string) =>
    group.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone';

  async function save(body: UpdateSettlement) {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open && question === null}
        size="full"
        title={title}
        description={description}
        onClose={onClose}
      >
        <SettleForm
          group={group}
          meId={meId}
          minorUnits={minorUnits}
          symbol={symbol}
          draft={draft}
          onChange={setDraft}
          nets={nets}
          suggested={suggested}
          submitLabel={submitLabel}
          busy={busy}
          error={error}
          onSubmit={(body) => {
            const over = overpayment(nets, body.fromUserId, body.toUserId, body.amount);
            if (!over) {
              void save(body);
              return;
            }
            const id = over.side === 'payer' ? body.fromUserId : body.toUserId;
            setQuestion({
              body,
              message: overpaymentMessage(over, { id, meId, name: nameOf(id) }, money),
            });
          }}
        />
      </Dialog>
      <Dialog
        open={open && question !== null}
        title={`${confirmLabel}?`}
        description={
          question && <>{question.message} The balance between them will then go the other way.</>
        }
        onClose={() => setQuestion(null)}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setQuestion(null)}>
            Change amount
          </Button>
          <Button
            onClick={() => {
              const body = question!.body;
              setQuestion(null);
              void save(body);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** The group's nets for its currency, by person. */
export function netsOf(
  balances: { balances: { currency: string; nets: { userId: string; amount: number }[] }[] },
  currency: string,
): Map<string, number> {
  const entry = balances.balances.find((b) => b.currency === currency);
  return new Map(entry?.nets.map((l) => [l.userId, l.amount]) ?? []);
}

/**
 * Record a payment in a group, pre-filled from a suggested payment (`from` and `to`), or from my
 * own position when opened without one.
 */
export function NewSettlementDialog({
  groupId,
  from,
  to,
  onClose,
}: {
  groupId: string;
  from?: string;
  to?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const group = useQuery(groupQuery(groupId));
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const balances = useQuery(balancesQuery(groupId));
  // One ID per opening: a retry after a lost response replays instead of recording twice.
  const [id] = useState(uuidv7);

  const currency = currencies.data?.items.find((c) => c.code === group.data?.currency);
  if (!group.data || !me.data || !balances.data || !currency) {
    return (
      <Dialog open size="full" title="Record a payment" onClose={onClose}>
        {(group.error ?? balances.error) ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(group.error ?? balances.error)}
          </p>
        ) : (
          <Skeleton className="h-80 w-full rounded-xl" />
        )}
      </Dialog>
    );
  }

  const data = group.data;
  const meId = me.data.id;
  const transfers =
    balances.data.balances.find((b) => b.currency === data.currency)?.transfers ?? [];
  const active = data.members.filter((m) => m.leftAt === null).map((m) => m.user.id);
  const isPerson = (userId: string | undefined): userId is string =>
    userId !== undefined && data.members.some((m) => m.user.id === userId);
  const pair = isPerson(from) && isPerson(to) ? { from, to } : defaultPair(transfers, meId, active);
  const amount = suggestedAmount(transfers, pair.from, pair.to);
  const nameOf = (userId: string) =>
    userId === meId ? 'You' : (data.members.find((m) => m.user.id === userId)?.user.name ?? '');
  const money = (value: number) =>
    formatMoney(value, currency.minorUnits, Intl, {
      locale: navigator.language,
      currency: data.currency,
    });

  return (
    <SettleDialog
      title="Record a payment"
      description={`In ${groupTitle(data, meId)}`}
      group={data}
      meId={meId}
      minorUnits={currency.minorUnits}
      symbol={currency.symbol}
      initial={{
        fromUserId: pair.from,
        toUserId: pair.to,
        amountText: amount === null ? '' : toDecimalString(amount, currency.minorUnits),
        occurredOn: localDate(),
        method: defaultMethod(data.currency),
        reference: '',
        note: '',
      }}
      nets={netsOf(balances.data, data.currency)}
      suggested={(a, b) => suggestedAmount(transfers, a, b)}
      submitLabel="Record payment"
      confirmLabel="Record anyway"
      onSubmit={async (body) => {
        const saved = await api.createSettlement(groupId, { id, ...body });
        const words = `${paymentSentence(body.fromUserId, body.toUserId, meId, nameOf)} ${money(body.amount)}`;
        onClose();
        toast(`Recorded: ${words}`, {
          action: {
            label: 'Undo',
            run: () =>
              void api
                .deleteTransaction(saved.id, saved.version)
                .then(() => afterTransactionChange(queryClient, groupId, saved.id))
                .then(() => toast('Payment removed'))
                .catch((err: unknown) => toast(errorMessage(err), { tone: 'error' })),
          },
        });
        await afterTransactionChange(queryClient, groupId, saved.id);
      }}
      onClose={onClose}
    />
  );
}
