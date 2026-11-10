import { MAX_AMOUNT_MINOR } from '@fairshare/core';
import { describe, expect, it } from 'vitest';
import {
  Amount,
  CurrencyCode,
  Email,
  IsoDate,
  latestOccurredOn,
  Line,
  Money,
  OccurredOn,
  PersonName,
  SignedAmount,
  Timestamp,
  Uuid,
  Version,
} from './primitives';
import { ids, rejectedPaths } from './testing/fixtures';

const ok = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('Uuid', () => {
  it('accepts UUIDv7 and v4', () => {
    expect(ok(Uuid, '0190a4b2-7c3d-7e4f-8a1b-2c3d4e5f6a7b')).toBe(true);
    expect(ok(Uuid, '9b2e4c1a-3f5d-4e6a-8b7c-1d2e3f4a5b6c')).toBe(true);
  });

  it.each([
    '',
    'not-a-uuid',
    '0190a4b2-7c3d-7e4f-8a1b-2c3d4e5f6a7',
    '0190a4b27c3d7e4f8a1b2c3d4e5f6a7b',
  ])('rejects %j', (value) => expect(ok(Uuid, value)).toBe(false));
});

describe('CurrencyCode', () => {
  it('accepts three uppercase letters', () => expect(ok(CurrencyCode, 'INR')).toBe(true));
  it.each(['inr', 'IN', 'INRR', '₹', 'IN1'])('rejects %j', (value) =>
    expect(ok(CurrencyCode, value)).toBe(false),
  );
});

describe('IsoDate', () => {
  it.each(['2026-11-05', '2024-02-29', '2000-01-01'])('accepts %j', (value) =>
    expect(ok(IsoDate, value)).toBe(true),
  );

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-5', '05-11-2026', '2026-11-05T00:00'])(
    'rejects %j',
    (value) => expect(ok(IsoDate, value)).toBe(false),
  );
});

describe('Timestamp', () => {
  it('accepts UTC', () => expect(ok(Timestamp, '2026-11-05T10:00:00.000Z')).toBe(true));
  it('rejects an offset, because timestamps are always UTC', () =>
    expect(ok(Timestamp, '2026-11-05T15:30:00+05:30')).toBe(false));
});

describe('Amount', () => {
  it('accepts 1 and the cap', () => {
    expect(ok(Amount, 1)).toBe(true);
    expect(ok(Amount, MAX_AMOUNT_MINOR)).toBe(true);
  });

  it.each([0, -1, MAX_AMOUNT_MINOR + 1, 1.5, Number.NaN, Infinity, '100', null])(
    'rejects %j',
    (value) => expect(ok(Amount, value)).toBe(false),
  );
});

describe('SignedAmount and Money', () => {
  it('allow negative balances', () => {
    expect(ok(SignedAmount, -95_000)).toBe(true);
    expect(ok(Money, { amount: -95_000, currency: 'INR' })).toBe(true);
  });

  it('reject fractions and unsafe integers', () => {
    expect(ok(SignedAmount, -0.5)).toBe(false);
    expect(ok(SignedAmount, 2 ** 53)).toBe(false);
  });
});

describe('Line', () => {
  it('accepts a positive amount', () => expect(ok(Line, { userId: ids.a, amount: 1 })).toBe(true));

  it('rejects zero and unknown keys', () => {
    expect(rejectedPaths(Line, { userId: ids.a, amount: 0 })).toEqual(['amount']);
    expect(ok(Line, { userId: ids.a, amount: 1, note: 'x' })).toBe(false);
  });
});

describe('Version', () => {
  it('fits a Postgres integer and starts at 1', () => {
    expect(ok(Version, 1)).toBe(true);
    expect(ok(Version, 2_147_483_647)).toBe(true);
    expect(ok(Version, 0)).toBe(false);
    expect(ok(Version, 2_147_483_648)).toBe(false);
  });
});

describe('PersonName', () => {
  it('trims', () => expect(PersonName.parse('  Asha  ')).toBe('Asha'));

  it('accepts 60 characters and rejects 61 or blank', () => {
    expect(ok(PersonName, 'x'.repeat(60))).toBe(true);
    expect(ok(PersonName, 'x'.repeat(61))).toBe(false);
    expect(ok(PersonName, '   ')).toBe(false);
  });
});

describe('Email', () => {
  it('trims before validating', () =>
    expect(Email.parse(' asha@example.com ')).toBe('asha@example.com'));
  it.each(['asha', 'asha@', '@example.com', 'a b@example.com'])('rejects %j', (value) =>
    expect(ok(Email, value)).toBe(false),
  );
});

describe('OccurredOn', () => {
  it('accepts 2000-01-01 and rejects anything earlier', () => {
    expect(ok(OccurredOn, '2000-01-01')).toBe(true);
    expect(rejectedPaths(OccurredOn, '1999-12-31')).toEqual(['']);
  });

  it('still rejects impossible dates', () => expect(ok(OccurredOn, '2026-02-30')).toBe(false));
});

describe('latestOccurredOn', () => {
  it('is today + 365 days', () => expect(latestOccurredOn('2026-11-07')).toBe('2027-11-07'));

  it('counts days across leap years, not calendar years', () => {
    expect(latestOccurredOn('2024-02-29')).toBe('2025-02-28');
    expect(latestOccurredOn('2023-03-01')).toBe('2024-02-29');
    expect(latestOccurredOn('2026-12-31')).toBe('2027-12-31');
  });

  it('rejects a malformed today', () => {
    expect(() => latestOccurredOn('2026-02-30')).toThrow(TypeError);
    expect(() => latestOccurredOn('')).toThrow('Invalid date');
  });
});
