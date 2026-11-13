import { z } from 'zod';

/**
 * What the history list is narrowed to (Blueprint 7.2 "search box plus filter chips: person,
 * expenses vs. payments, date range", and "show deleted"). On a group's page these live in the
 * URL, so they survive opening an expense and coming back.
 */
export const HistoryFilters = z.object({
  q: z.string().max(100).optional().catch(undefined),
  person: z.uuid().optional().catch(undefined),
  type: z.enum(['expense', 'settlement']).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  deleted: z.boolean().optional().catch(undefined),
});
export type HistoryFilters = z.infer<typeof HistoryFilters>;

/** Whether anything narrows the list (the search counts from 2 characters, as the API's does). */
export function isFiltering(filters: HistoryFilters): boolean {
  return (
    (filters.q?.trim().length ?? 0) >= 2 ||
    Boolean(filters.person || filters.type || filters.from || filters.to || filters.deleted)
  );
}

/** Drops empty values, so the URL and the query key only carry what's set. */
export function compact(filters: HistoryFilters): HistoryFilters {
  const q = filters.q?.trim();
  return {
    ...(q && { q }),
    ...(filters.person && { person: filters.person }),
    ...(filters.type && { type: filters.type }),
    ...(filters.from && { from: filters.from }),
    ...(filters.to && { to: filters.to }),
    ...(filters.deleted && { deleted: true }),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** This month and last month, as from/to dates (local calendar). */
export function monthRange(which: 'this' | 'last', now = new Date()) {
  const offset = which === 'this' ? 0 : -1;
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last) };
}

/** The dates chip: "Dates", "3 Nov – 10 Nov", "From 3 Nov", "Until 10 Nov". */
export function datesLabel(from: string | undefined, to: string | undefined, locale?: string) {
  const short = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
      new Date(y!, m! - 1, d),
    );
  };
  if (from && to) return from === to ? short(from) : `${short(from)} – ${short(to)}`;
  if (from) return `From ${short(from)}`;
  if (to) return `Until ${short(to)}`;
  return 'Dates';
}
