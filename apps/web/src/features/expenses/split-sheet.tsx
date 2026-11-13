import type { Group } from '@fairshare/contracts';
import type { SplitMethod } from '@fairshare/core';
import { Minus, Plus } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import {
  assignRemaining,
  clampShares,
  fillRemainder,
  percentText,
  splitPaymentEvenly,
  switchMethod,
  toMultiplePayers,
  toSinglePayer,
  type ExpenseDraft,
  type Left,
  type SplitState,
} from './split-draft';

const METHODS: { method: SplitMethod; label: string; name: string }[] = [
  { method: 'equal', label: 'Equal', name: 'Equally' },
  { method: 'exact', label: 'Exact', name: 'Exact amounts' },
  { method: 'percent', label: '%', name: 'Percentages' },
  { method: 'shares', label: 'Shares', name: 'Shares' },
];

const row = 'flex min-h-11 items-center gap-3 rounded-md px-2';
const numberInput =
  'h-9 w-28 rounded-md border border-input bg-background px-2 text-right text-base tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 sm:text-sm';

/**
 * The Split sheet (Blueprint 7.3): who paid (one person, or several with what each paid), and how
 * it's split: Equal · Exact · % · Shares. Every amount shown comes from the form's evaluation,
 * which runs core.computeShares with the expense's ID as the seed, so it's what will be saved.
 */
export function SplitSheet({
  group,
  meId,
  draft,
  state,
  seed,
  minorUnits,
  money,
  onChange,
}: {
  group: Group;
  meId: string;
  draft: ExpenseDraft;
  state: SplitState;
  seed: string;
  minorUnits: number;
  money: (amount: number) => string;
  onChange: (changes: Partial<Pick<ExpenseDraft, 'payers' | 'split'>>) => void;
}) {
  const { payers, split } = draft;
  // Active members, plus anyone this expense already names who has since left (when editing).
  const named = new Set([
    ...(payers.mode === 'single' ? [payers.userId] : Object.keys(payers.amounts)),
    ...split.participants,
    ...Object.keys(split.exact),
    ...Object.keys(split.percent),
    ...Object.keys(split.shares),
  ]);
  const people = group.members.filter((m) => m.leftAt === null || named.has(m.user.id));
  const nameOf = (userId: string) => {
    const m = group.members.find((x) => x.user.id === userId);
    return m ? (m.user.id === meId ? `${m.user.name} (you)` : m.user.name) : 'Someone';
  };
  const shareOf = (userId: string) => state.shares?.find((s) => s.userId === userId)?.amount;
  const setSplit = (changes: Partial<typeof split>) =>
    onChange({ split: { ...split, ...changes } });

  return (
    <div id="split-panel" className="flex flex-col gap-5 rounded-lg border p-3">
      {/* ---- Paid by */}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Paid by</legend>
        {payers.mode === 'single' ? (
          <>
            {people.map((m) => (
              <label key={m.user.id} className={cn(row, 'cursor-pointer hover:bg-muted')}>
                <input
                  type="radio"
                  name="payer"
                  checked={payers.userId === m.user.id}
                  onChange={() => onChange({ payers: { mode: 'single', userId: m.user.id } })}
                  className="size-4 accent-[var(--primary)]"
                />
                <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                <span className="text-sm">{nameOf(m.user.id)}</span>
              </label>
            ))}
            <Button
              type="button"
              variant="link"
              className="self-start"
              onClick={() =>
                onChange({ payers: toMultiplePayers(payers, state.amount, minorUnits) })
              }
            >
              Several people paid
            </Button>
          </>
        ) : (
          <>
            {people.map((m) => {
              const id = m.user.id;
              const ticked = id in payers.amounts;
              return (
                <div key={id} className={row}>
                  <input
                    type="checkbox"
                    aria-label={`${nameOf(id)} paid`}
                    checked={ticked}
                    onChange={() => {
                      const amounts = { ...payers.amounts };
                      if (ticked) delete amounts[id];
                      else amounts[id] = '';
                      onChange({ payers: { mode: 'multiple', amounts } });
                    }}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                  <span className="flex-1 text-sm">{nameOf(id)}</span>
                  <input
                    aria-label={`What ${nameOf(id)} paid`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    disabled={!ticked}
                    value={payers.amounts[id] ?? ''}
                    onChange={(event) =>
                      onChange({
                        payers: {
                          mode: 'multiple',
                          amounts: { ...payers.amounts, [id]: cleanNumber(event.target.value) },
                        },
                      })
                    }
                    className={numberInput}
                  />
                </div>
              );
            })}
            {state.payersLeft !== null && (
              <LeftBar
                left={{ amount: state.payersLeft, unit: 'money' }}
                money={money}
                label="paid"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={state.amount === null || Object.keys(payers.amounts).length === 0}
                onClick={() =>
                  state.amount !== null &&
                  onChange({ payers: splitPaymentEvenly(payers, state.amount, seed, minorUnits) })
                }
              >
                Split payment equally
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange({ payers: toSinglePayer(payers, meId, minorUnits) })}
              >
                One person paid
              </Button>
            </div>
          </>
        )}
      </fieldset>

      {/* ---- Split */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Split</legend>
        <div className="grid grid-cols-4 rounded-lg bg-muted p-1">
          {METHODS.map(({ method, label, name }) => (
            <button
              key={method}
              type="button"
              aria-label={name}
              aria-pressed={split.method === method}
              onClick={() =>
                onChange({
                  split: switchMethod(split, method, { shares: state.shares, seed, minorUnits }),
                })
              }
              className={cn(
                'flex h-9 items-center justify-center rounded-md text-sm font-medium',
                split.method === method ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {split.method === 'equal' && (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setSplit({
                    participants: people.filter((m) => m.leftAt === null).map((m) => m.user.id),
                  })
                }
              >
                Everyone
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSplit({ participants: [] })}
              >
                Nobody
              </Button>
            </div>
            {people.map((m) => {
              const id = m.user.id;
              const checked = split.participants.includes(id);
              const share = shareOf(id);
              return (
                <label key={id} className={cn(row, 'cursor-pointer hover:bg-muted')}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSplit({
                        participants: checked
                          ? split.participants.filter((p) => p !== id)
                          : [...split.participants, id],
                      })
                    }
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                  <span className="flex-1 text-sm">{nameOf(id)}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {share !== undefined ? money(share) : ''}
                  </span>
                </label>
              );
            })}
            <RoundingNote shares={state.shares} money={money} />
          </>
        )}

        {split.method === 'exact' && (
          <>
            {people.map((m) => (
              <div key={m.user.id} className={row}>
                <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                <span className="flex-1 text-sm">{nameOf(m.user.id)}</span>
                <input
                  aria-label={`${nameOf(m.user.id)}’s amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={split.exact[m.user.id] ?? ''}
                  onChange={(event) =>
                    setSplit({
                      exact: { ...split.exact, [m.user.id]: cleanNumber(event.target.value) },
                    })
                  }
                  className={numberInput}
                />
              </div>
            ))}
            {state.splitLeft && (
              <LeftBar left={state.splitLeft} money={money} label="assigned">
                <AssignTo
                  label="Assign remaining to"
                  people={people}
                  nameOf={nameOf}
                  onPick={(userId) => {
                    const next = assignRemaining(
                      split,
                      userId,
                      state.splitLeft!.amount,
                      minorUnits,
                    );
                    if (next) onChange({ split: next });
                  }}
                />
              </LeftBar>
            )}
          </>
        )}

        {split.method === 'percent' && (
          <>
            {people.map((m) => {
              const share = shareOf(m.user.id);
              return (
                <div key={m.user.id} className={row}>
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{nameOf(m.user.id)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {share !== undefined ? money(share) : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <input
                      aria-label={`${nameOf(m.user.id)}’s percentage`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      value={split.percent[m.user.id] ?? ''}
                      onChange={(event) =>
                        setSplit({
                          percent: {
                            ...split.percent,
                            [m.user.id]: cleanNumber(event.target.value, false),
                          },
                        })
                      }
                      className={cn(numberInput, 'w-20')}
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      %
                    </span>
                  </span>
                </div>
              );
            })}
            {state.splitLeft && (
              <LeftBar left={state.splitLeft} money={money} label="assigned">
                <AssignTo
                  label="Fill remainder"
                  people={people}
                  nameOf={nameOf}
                  onPick={(userId) => {
                    const next = fillRemainder(split, userId, state.splitLeft!.amount);
                    if (next) onChange({ split: next });
                  }}
                />
              </LeftBar>
            )}
          </>
        )}

        {split.method === 'shares' && (
          <>
            {people.map((m) => {
              const id = m.user.id;
              const n = split.shares[id] ?? 0;
              const share = shareOf(id);
              const set = (value: number) =>
                setSplit({ shares: { ...split.shares, [id]: clampShares(value) } });
              return (
                <div key={id} className={row}>
                  <Avatar name={m.user.name} src={m.user.avatarUrl} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{nameOf(id)}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {share !== undefined ? money(share) : n === 0 ? 'not in this one' : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-9"
                      aria-label={`Fewer shares for ${nameOf(id)}`}
                      disabled={n === 0}
                      onClick={() => set(n - 1)}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <input
                      aria-label={`${nameOf(id)}’s shares`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={String(n)}
                      onChange={(event) =>
                        set(Number(event.target.value.replace(/\D/g, '') || '0'))
                      }
                      className={cn(numberInput, 'w-14 text-center')}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-9"
                      aria-label={`More shares for ${nameOf(id)}`}
                      onClick={() => set(n + 1)}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </fieldset>
    </div>
  );
}

/** Only digits, one separator for decimals (and commas, for money). */
function cleanNumber(value: string, commas = true): string {
  return value.replace(commas ? /[^\d.,]/g : /[^\d.]/g, '');
}

/**
 * "₹100.00 left to assign" (green once it's all assigned). Live, so a screen reader hears it
 * change. `label`: what the total is made of ("paid", "assigned").
 */
function LeftBar({
  left,
  money,
  label,
  children,
}: {
  left: Left;
  money: (amount: number) => string;
  label: string;
  children?: React.ReactNode;
}) {
  const show = (value: number) => (left.unit === 'money' ? money(value) : `${percentText(value)}%`);
  const text =
    left.amount === 0
      ? `All ${label}`
      : left.amount > 0
        ? `${show(left.amount)} left to assign`
        : `${show(-left.amount)} too much`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p
        role="status"
        className={cn(
          'rounded-md px-2 py-1 text-sm font-medium tabular-nums',
          left.amount === 0
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
            : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
        )}
      >
        {text}
      </p>
      {left.amount !== 0 && children}
    </div>
  );
}

/** "Assign remaining to…": a picker that applies at once and resets. */
function AssignTo({
  label,
  people,
  nameOf,
  onPick,
}: {
  label: string;
  people: Group['members'];
  nameOf: (userId: string) => string;
  onPick: (userId: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value=""
      onChange={(event) => event.target.value && onPick(event.target.value)}
      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">{label}…</option>
      {people.map((m) => (
        <option key={m.user.id} value={m.user.id}>
          {nameOf(m.user.id)}
        </option>
      ))}
    </select>
  );
}

/** "₹333.33 each, and ₹0.01 more for 1 person" when an equal split doesn't divide evenly. */
function RoundingNote({
  shares,
  money,
}: {
  shares: { amount: number }[] | null;
  money: (amount: number) => string;
}) {
  if (!shares || shares.length < 2) return null;
  const low = Math.min(...shares.map((s) => s.amount));
  const extra = shares.filter((s) => s.amount > low).length;
  if (extra === 0) return null;
  // Largest remainder rounding: everyone gets `low` or one minor unit more.
  return (
    <p className="px-2 text-xs text-muted-foreground">
      {money(low)} each, and {money(1)} more for {extra} {extra === 1 ? 'person' : 'people'}
    </p>
  );
}
