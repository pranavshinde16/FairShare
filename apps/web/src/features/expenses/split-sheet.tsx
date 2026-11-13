import type { Group } from '@fairshare/contracts';
import type { SplitMethod } from '@fairshare/core';
import { CircleCheck, Minus, Plus, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/common/avatar';
import { Button } from '../../components/ui/button';
import { ListCard } from '../../components/ui/list-card';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { plural } from '../../lib/money';
import { cn } from '../../lib/utils';
import {
  assignRemaining,
  canTakePart,
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
  { method: 'equal', label: 'Equal', name: 'Equal split' },
  { method: 'exact', label: 'Exact', name: 'Exact split' },
  { method: 'percent', label: '%', name: 'Percentages' },
  { method: 'shares', label: 'Shares', name: 'Shares' },
];

/** A row in the editor's lists: 56px, a 36px avatar (DESIGN_SPEC §4 SplitEditor). */
const row = 'flex min-h-14 items-center gap-2.5 px-3.5 py-2';
const numberInput =
  'h-11 w-[108px] shrink-0 rounded-md border bg-card px-3 text-right text-base font-semibold tabular-nums outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-focus-ring disabled:bg-muted disabled:opacity-45';
const checkbox = 'size-5 shrink-0 accent-[var(--primary)]';
const legend = 'mb-1.5 text-[13px] font-bold';

/**
 * The "Paid by & split" editor (DESIGN_SPEC §4 SplitEditor, m-split-*): who paid (one person, or
 * several with what each paid), and how it's split: Equal · Exact · % · Shares. Every amount shown
 * comes from the form's evaluation, which runs core.computeShares with the expense's ID as the
 * seed, so it's what will be saved.
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
  // Members who can take part, plus anyone this expense already names who has since left or
  // deleted their account (when editing).
  const named = new Set([
    ...(payers.mode === 'single' ? [payers.userId] : Object.keys(payers.amounts)),
    ...split.participants,
    ...Object.keys(split.exact),
    ...Object.keys(split.percent),
    ...Object.keys(split.shares),
  ]);
  const people = group.members.filter((m) => canTakePart(m) || named.has(m.user.id));
  const nameOf = (userId: string) => {
    const m = group.members.find((x) => x.user.id === userId);
    return m ? (m.user.id === meId ? `${m.user.name} (you)` : m.user.name) : 'Someone';
  };
  const shareOf = (userId: string) => state.shares?.find((s) => s.userId === userId)?.amount;
  const setSplit = (changes: Partial<typeof split>) =>
    onChange({ split: { ...split, ...changes } });
  const avatar = (m: (typeof people)[number]) => (
    <Avatar
      name={m.user.name}
      src={m.user.avatarUrl}
      seed={m.user.id}
      deleted={m.user.isDeleted}
      size={36}
    />
  );
  const personName = (id: string) => (
    <span className="min-w-0 flex-1 text-[15px] leading-5 font-bold break-words">{nameOf(id)}</span>
  );

  return (
    <div id="split-panel" className="flex flex-col gap-3.5">
      {/* ---- Paid by */}
      <fieldset className="flex flex-col gap-2.5">
        <legend className={legend}>Paid by</legend>
        <SegmentedControl
          segments={[
            { value: 'single', label: 'One person', name: 'One person paid' },
            { value: 'multiple', label: 'Several people', name: 'Several people paid' },
          ]}
          value={payers.mode}
          onChange={(mode) => {
            if (mode === payers.mode) return;
            onChange({
              payers:
                mode === 'multiple'
                  ? toMultiplePayers(payers, state.amount, minorUnits)
                  : toSinglePayer(payers, meId, minorUnits),
            });
          }}
        />
        {payers.mode === 'single' ? (
          <ListCard inset="icon" className="[&>li+li]:before:left-[90px]">
            {people.map((m) => (
              <li key={m.user.id}>
                <label className={cn(row, 'cursor-pointer hover:bg-muted/60')}>
                  <input
                    type="radio"
                    name="payer"
                    checked={payers.userId === m.user.id}
                    onChange={() => onChange({ payers: { mode: 'single', userId: m.user.id } })}
                    className={checkbox}
                  />
                  {avatar(m)}
                  {personName(m.user.id)}
                </label>
              </li>
            ))}
          </ListCard>
        ) : (
          <>
            <ListCard inset="icon" className="[&>li+li]:before:left-[90px]">
              {people.map((m) => {
                const id = m.user.id;
                const ticked = id in payers.amounts;
                return (
                  <li key={id} className={row}>
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
                      className={checkbox}
                    />
                    {avatar(m)}
                    {personName(id)}
                    <input
                      aria-label={`What ${nameOf(id)} paid`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
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
                  </li>
                );
              })}
            </ListCard>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {state.payersLeft !== null && (
                <LeftBar
                  left={{ amount: state.payersLeft, unit: 'money' }}
                  money={money}
                  label="paid"
                />
              )}
              <Button
                type="button"
                size="sm"
                variant="tint"
                disabled={state.amount === null || Object.keys(payers.amounts).length === 0}
                onClick={() =>
                  state.amount !== null &&
                  onChange({ payers: splitPaymentEvenly(payers, state.amount, seed, minorUnits) })
                }
              >
                Split payment equally
              </Button>
            </div>
          </>
        )}
      </fieldset>

      <div aria-hidden className="h-px bg-border" />

      {/* ---- Split */}
      <fieldset className="flex flex-col gap-2.5">
        <legend className={legend}>Split</legend>
        <SegmentedControl
          segments={METHODS.map(({ method, label, name }) => ({ value: method, label, name }))}
          value={split.method}
          onChange={(method) =>
            onChange({
              split: switchMethod(split, method, { shares: state.shares, seed, minorUnits }),
            })
          }
        />

        {split.method === 'equal' && (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="soft"
                onClick={() =>
                  setSplit({ participants: people.filter(canTakePart).map((m) => m.user.id) })
                }
              >
                Everyone
              </Button>
              <Button
                type="button"
                size="sm"
                variant="soft"
                onClick={() => setSplit({ participants: [] })}
              >
                Nobody
              </Button>
            </div>
            <ListCard inset="icon" className="[&>li+li]:before:left-[90px]">
              {people.map((m) => {
                const id = m.user.id;
                const checked = split.participants.includes(id);
                const share = shareOf(id);
                return (
                  <li key={id}>
                    <label className={cn(row, 'cursor-pointer hover:bg-muted/60')}>
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
                        className={checkbox}
                      />
                      {avatar(m)}
                      {personName(id)}
                      <span className="text-[15px] font-semibold text-muted-foreground tabular-nums">
                        {share !== undefined ? money(share) : ''}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ListCard>
            <RoundingNote shares={state.shares} money={money} />
          </>
        )}

        {split.method === 'exact' && (
          <>
            <ListCard inset="avatar" className="[&>li+li]:before:left-[60px]">
              {people.map((m) => (
                <li key={m.user.id} className={row}>
                  {avatar(m)}
                  {personName(m.user.id)}
                  <input
                    aria-label={`${nameOf(m.user.id)}’s exact share`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={split.exact[m.user.id] ?? ''}
                    onChange={(event) =>
                      setSplit({
                        exact: { ...split.exact, [m.user.id]: cleanNumber(event.target.value) },
                      })
                    }
                    className={numberInput}
                  />
                </li>
              ))}
            </ListCard>
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
            <ListCard inset="avatar" className="[&>li+li]:before:left-[60px]">
              {people.map((m) => {
                const share = shareOf(m.user.id);
                return (
                  <li key={m.user.id} className={row}>
                    {avatar(m)}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] leading-5 font-bold break-words">
                        {nameOf(m.user.id)}
                      </span>
                      <span className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                        {share !== undefined ? money(share) : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
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
                      <span aria-hidden className="text-[15px] font-bold text-muted-foreground">
                        %
                      </span>
                    </span>
                  </li>
                );
              })}
            </ListCard>
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
            <ListCard inset="avatar" className="[&>li+li]:before:left-[60px]">
              {people.map((m) => {
                const id = m.user.id;
                const n = split.shares[id] ?? 0;
                const share = shareOf(id);
                const set = (value: number) =>
                  setSplit({ shares: { ...split.shares, [id]: clampShares(value) } });
                return (
                  <li key={id} className={row}>
                    {avatar(m)}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] leading-5 font-bold break-words">
                        {nameOf(id)}
                      </span>
                      <span className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                        {share !== undefined ? money(share) : n === 0 ? 'not in this one' : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="shadow-none"
                        aria-label={`Fewer shares for ${nameOf(id)}`}
                        disabled={n === 0}
                        onClick={() => set(n - 1)}
                      >
                        <Minus aria-hidden strokeWidth={1.9} />
                      </Button>
                      <input
                        aria-label={`${nameOf(id)}’s shares`}
                        inputMode="numeric"
                        autoComplete="off"
                        value={String(n)}
                        onChange={(event) =>
                          set(Number(event.target.value.replace(/\D/g, '') || '0'))
                        }
                        className={cn(numberInput, 'w-12 px-1 text-center')}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="shadow-none"
                        aria-label={`More shares for ${nameOf(id)}`}
                        onClick={() => set(n + 1)}
                      >
                        <Plus aria-hidden strokeWidth={1.9} />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ListCard>
            <SharesNote
              shares={Object.values(split.shares).reduce((sum, n) => sum + (n ?? 0), 0)}
              amount={state.amount}
              money={money}
            />
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
 * "All assigned" (owed tint) or "₹100.00 left to assign" / "too much" (owe tint), as a pill with an
 * icon, so colour isn't the only cue. Live, so a screen reader hears it change. `label`: what the
 * total is made of ("paid", "assigned").
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
  children?: ReactNode;
}) {
  const show = (value: number) => (left.unit === 'money' ? money(value) : `${percentText(value)}%`);
  const text =
    left.amount === 0
      ? `All ${label}`
      : left.amount > 0
        ? `${show(left.amount)} left to assign`
        : `${show(-left.amount)} too much`;
  const Icon = left.amount === 0 ? CircleCheck : TriangleAlert;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold tabular-nums',
          left.amount === 0 ? 'bg-owed-muted text-owed' : 'bg-owe-muted text-owe-muted-foreground',
        )}
      >
        <Icon aria-hidden className="size-4" strokeWidth={1.9} />
        <span role="status">{text}</span>
      </span>
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
      className="h-11 rounded-md border-0 bg-accent px-3 text-sm font-bold text-accent-foreground outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
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
    <p className="text-[13px] leading-5 text-muted-foreground">
      {money(low)} each, and {money(1)} more for {extra} {extra === 1 ? 'person' : 'people'}
    </p>
  );
}

/** "4 shares · ₹750.00 per share" (m-split-shares); the shares themselves round per person. */
function SharesNote({
  shares,
  amount,
  money,
}: {
  shares: number;
  amount: number | null;
  money: (amount: number) => string;
}) {
  if (shares === 0) return null;
  return (
    <p className="text-[13px] leading-5 font-semibold text-muted-foreground tabular-nums">
      {plural(shares, 'share', 'shares')}
      {amount !== null && <> · {money(Math.floor(amount / shares))} per share</>}
    </p>
  );
}
