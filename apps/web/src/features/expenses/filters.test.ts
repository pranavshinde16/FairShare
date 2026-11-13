import { describe, expect, it } from 'vitest';
import { compact, datesLabel, HistoryFilters, isFiltering, monthRange } from './filters';

const P = '01900000-0000-7000-8000-000000000001';

describe('HistoryFilters', () => {
  it('reads what the URL holds, dropping what it can’t use', () => {
    expect(
      HistoryFilters.parse({
        q: 'taxi',
        person: P,
        type: 'settlement',
        from: '2026-11-01',
        deleted: true,
      }),
    ).toEqual({ q: 'taxi', person: P, type: 'settlement', from: '2026-11-01', deleted: true });
    expect(
      HistoryFilters.parse({ person: 'nobody', type: 'refund', from: '2026-02-30', to: 'soon' }),
    ).toEqual({});
  });

  it('counts a search from two characters, like the API', () => {
    expect(isFiltering({})).toBe(false);
    expect(isFiltering({ q: ' a ' })).toBe(false);
    expect(isFiltering({ q: 'ab' })).toBe(true);
    for (const f of [
      { person: P },
      { type: 'expense' as const },
      { from: '2026-11-01' },
      { to: '2026-11-01' },
      { deleted: true },
    ]) {
      expect(isFiltering(f)).toBe(true);
    }
  });

  it('keeps only what’s set, trimmed', () => {
    expect(compact({ q: '  ', person: undefined, deleted: false, type: 'expense' })).toEqual({
      type: 'expense',
    });
    expect(compact({ q: ' taxi ', to: '2026-11-30' })).toEqual({ q: 'taxi', to: '2026-11-30' });
  });
});

describe('dates', () => {
  it('gives this month and last month, across a year', () => {
    expect(monthRange('this', new Date(2026, 10, 12))).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(monthRange('last', new Date(2026, 0, 5))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(monthRange('last', new Date(2028, 2, 31))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('labels the dates chip', () => {
    expect(datesLabel(undefined, undefined, 'en-US')).toBe('Dates');
    expect(datesLabel('2026-11-03', '2026-11-10', 'en-US')).toBe('Nov 3 – Nov 10');
    expect(datesLabel('2026-11-03', '2026-11-03', 'en-US')).toBe('Nov 3');
    expect(datesLabel('2026-11-03', undefined, 'en-US')).toBe('From Nov 3');
    expect(datesLabel(undefined, '2026-11-10', 'en-US')).toBe('Until Nov 10');
  });
});
