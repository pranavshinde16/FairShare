import type { Group } from '@fairshare/contracts';
import { CalendarRange, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { chipClass, ChipSelect, ChipToggle } from '../../components/ui/filter-chips';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { compact, datesLabel, isFiltering, monthRange, type HistoryFilters } from './filters';

/** The search box, the person / type / dates chips, "Show deleted" and "Clear". */
export function HistoryFiltersBar({
  group,
  meId,
  filters,
  onChange,
}: {
  group: Group;
  meId: string;
  filters: HistoryFilters;
  onChange: (filters: HistoryFilters) => void;
}) {
  const set = (changes: Partial<HistoryFilters>) => onChange(compact({ ...filters, ...changes }));
  const [search, setSearch] = useState(filters.q ?? '');
  const [datesOpen, setDatesOpen] = useState(false);

  // The search applies 300 ms after typing stops.
  useEffect(() => {
    if (search.trim() === (filters.q ?? '')) return;
    const timer = setTimeout(() => set({ q: search }), 300);
    return () => clearTimeout(timer);
  });
  // …and follows the URL when it changes underneath (Back, "Clear").
  const [shownQ, setShownQ] = useState(filters.q);
  if (shownQ !== filters.q) {
    setShownQ(filters.q);
    if ((filters.q ?? '') !== search.trim()) setSearch(filters.q ?? '');
  }

  const people = group.members.filter((m) => m.leftAt === null || m.user.id === filters.person);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search expenses"
          placeholder="Search"
          // The browser's own clear button is replaced by ours, which also clears the address.
          className="pr-12 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setSearch('');
              set({ q: undefined });
            }}
            className="absolute top-1/2 right-0.5 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-focus-ring"
          >
            <X aria-hidden className="size-[18px]" strokeWidth={1.9} />
          </button>
        )}
      </div>

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
        <ChipSelect
          aria-label="Person"
          active={Boolean(filters.person)}
          value={filters.person ?? ''}
          onChange={(event) => set({ person: event.target.value || undefined })}
        >
          <option value="">Anyone</option>
          {people.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.id === meId ? 'You' : m.user.name}
            </option>
          ))}
        </ChipSelect>
        <ChipSelect
          aria-label="Type"
          active={Boolean(filters.type)}
          value={filters.type ?? ''}
          onChange={(event) =>
            set({ type: (event.target.value || undefined) as HistoryFilters['type'] })
          }
        >
          <option value="">Expenses and payments</option>
          <option value="expense">Expenses</option>
          <option value="settlement">Payments</option>
        </ChipSelect>
        <button
          type="button"
          className={chipClass(Boolean(filters.from || filters.to))}
          aria-label={`Dates: ${datesLabel(filters.from, filters.to)}`}
          onClick={() => setDatesOpen(true)}
        >
          <CalendarRange aria-hidden className="size-4" />
          {datesLabel(filters.from, filters.to)}
        </button>
        <ChipToggle
          checked={Boolean(filters.deleted)}
          onChange={(checked) => set({ deleted: checked || undefined })}
        >
          Show deleted
        </ChipToggle>
        {isFiltering(filters) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              onChange({});
            }}
          >
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>

      {datesOpen && (
        <DatesDialog
          from={filters.from}
          to={filters.to}
          onClose={() => setDatesOpen(false)}
          onApply={(from, to) => {
            set({ from, to });
            setDatesOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** From and To, with "This month" and "Last month" shortcuts. Either end may be left open. */
function DatesDialog({
  from: initialFrom,
  to: initialTo,
  onApply,
  onClose,
}: {
  from?: string;
  to?: string;
  onApply: (from: string | undefined, to: string | undefined) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const reversed = Boolean(from && to && from > to);
  return (
    <Dialog open title="Dates" onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        {(['this', 'last'] as const).map((which) => (
          <Button
            key={which}
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const range = monthRange(which);
              setFrom(range.from);
              setTo(range.to);
            }}
          >
            {which === 'this' ? 'This month' : 'Last month'}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="history-from">From</Label>
          <Input
            id="history-from"
            type="date"
            min="2000-01-01"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="history-to">To</Label>
          <Input
            id="history-to"
            type="date"
            min="2000-01-01"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      {reversed && (
        <p role="alert" className="text-sm text-destructive">
          “From” must not be after “To”.
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => onApply(undefined, undefined)}>
          Any date
        </Button>
        <Button disabled={reversed} onClick={() => onApply(from || undefined, to || undefined)}>
          Apply
        </Button>
      </div>
    </Dialog>
  );
}
