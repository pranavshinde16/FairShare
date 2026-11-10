import { describe, expect, it } from 'vitest';
import { formatIfMatch, parseIfMatch } from './concurrency';

describe('formatIfMatch', () => {
  it('quotes the version', () => expect(formatIfMatch(3)).toBe('"3"'));

  it('round-trips through parseIfMatch', () => {
    for (const version of [1, 7, 2_147_483_647]) {
      expect(parseIfMatch(formatIfMatch(version))).toBe(version);
    }
  });
});

describe('parseIfMatch', () => {
  it.each([
    ['"3"', 3],
    ['3', 3],
    [' "12" ', 12],
  ])('reads %j as %d', (header, version) => expect(parseIfMatch(header)).toBe(version));

  it.each([
    [null],
    [undefined],
    [''],
    ['*'],
    ['W/"3"'],
    ['"3", "4"'],
    ['"3'],
    ['3"'],
    ['"0"'],
    ['"-1"'],
    ['"1.5"'],
    ['"abc"'],
    ['"2147483648"'],
    ['"99999999999"'],
  ])('rejects %j', (header) => expect(parseIfMatch(header)).toBeNull());
});
