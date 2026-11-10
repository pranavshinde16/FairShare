import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Cursor, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, page, PageQuery } from './pagination';

describe('PageQuery', () => {
  it('defaults the limit', () => {
    expect(PageQuery.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
    expect(DEFAULT_PAGE_LIMIT).toBe(30);
  });

  it('reads the limit from a query string', () => {
    expect(PageQuery.parse({ limit: '50', cursor: 'eyJpZCI6MX0' })).toEqual({
      limit: 50,
      cursor: 'eyJpZCI6MX0',
    });
    expect(PageQuery.parse({ limit: String(MAX_PAGE_LIMIT) }).limit).toBe(100);
  });

  it.each(['0', '101', '1.5', 'abc', '', '-1'])('rejects limit=%j', (limit) =>
    expect(PageQuery.safeParse({ limit }).success).toBe(false),
  );

  it('rejects unknown parameters, so typos don’t silently do nothing', () =>
    expect(PageQuery.safeParse({ limt: '5' }).success).toBe(false));
});

describe('Cursor', () => {
  it('accepts base64url', () =>
    expect(Cursor.safeParse('MjAyNi0xMS0wNXwwMTkw-_A').success).toBe(true));

  it.each(['', 'a+b', 'a/b', 'abc=', 'x'.repeat(513)])('rejects %j', (cursor) =>
    expect(Cursor.safeParse(cursor).success).toBe(false),
  );
});

describe('page', () => {
  const NumberPage = page(z.int());

  it('wraps items with the next cursor', () => {
    expect(NumberPage.parse({ items: [1, 2], nextCursor: 'abc' })).toEqual({
      items: [1, 2],
      nextCursor: 'abc',
    });
  });

  it('uses null on the last page and validates each item', () => {
    expect(NumberPage.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(NumberPage.safeParse({ items: ['1'], nextCursor: null }).success).toBe(false);
    expect(NumberPage.safeParse({ items: [] }).success).toBe(false);
  });
});
