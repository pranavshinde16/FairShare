import type { DomainErrorCode } from '@fairshare/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ErrorCode,
  ErrorEnvelope,
  SumMismatchDetails,
  toValidationDetails,
  ValidationFailedDetails,
  VersionConflictDetails,
} from './errors';

/** Every DomainError code core can throw. The type check below fails if core adds one. */
const CORE_CODES = [
  'INVALID_MONEY',
  'INVALID_PERCENT',
  'AMOUNT_OUT_OF_RANGE',
  'NO_PARTICIPANTS',
  'DUPLICATE_USER',
  'INVALID_WEIGHT',
  'SPLIT_SUM_MISMATCH',
  'PAYER_SUM_MISMATCH',
  'PERCENT_SUM_INVALID',
  'SETTLEMENT_SAME_USER',
] as const;

describe('error codes', () => {
  it('include every core DomainError code, each mapped to 422', () => {
    expectTypeOf<DomainErrorCode>().toEqualTypeOf<(typeof CORE_CODES)[number]>();
    expectTypeOf<DomainErrorCode>().toExtend<ErrorCode>();
    for (const code of CORE_CODES) expect(ERROR_HTTP_STATUS[code]).toBe(422);
  });

  it('map the plan’s codes to the plan’s statuses', () => {
    expect(ERROR_HTTP_STATUS).toMatchObject({
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      NOT_FOUND: 404,
      VERSION_CONFLICT: 409,
      ID_CONFLICT: 409,
      BALANCE_NOT_ZERO: 409,
      MERGE_CONFLICT: 409,
      ALREADY_MEMBER: 409,
      INVITE_EXPIRED: 410,
      MEMBER_INACTIVE: 422,
      NOT_A_MEMBER: 422,
      CURRENCY_MISMATCH: 422,
      CANNOT_MODIFY_DIRECT_GROUP: 422,
      RATE_LIMITED: 429,
      AI_RATE_LIMITED: 429,
      AI_UNAVAILABLE: 503,
      INTERNAL: 500,
    });
  });

  it('are listed once each in ERROR_CODES and accepted by the ErrorCode schema', () => {
    expect(new Set(ERROR_CODES).size).toBe(Object.keys(ERROR_HTTP_STATUS).length);
    for (const code of ERROR_CODES) expect(ErrorCode.parse(code)).toBe(code);
    expect(ErrorCode.safeParse('TEAPOT').success).toBe(false);
  });

  it('are SCREAMING_SNAKE_CASE', () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
  });
});

describe('ErrorEnvelope', () => {
  it('accepts the plan’s example', () => {
    const body = {
      error: {
        code: 'SPLIT_SUM_MISMATCH',
        message: 'Split amounts add up to ₹2,300 but the expense is ₹2,400.',
        details: { expected: 240000, actual: 230000 },
        requestId: '01JC0000000000000000000000',
      },
    };
    expect(ErrorEnvelope.parse(body)).toEqual(body);
    expect(SumMismatchDetails.parse(body.error.details)).toEqual({
      expected: 240000,
      actual: 230000,
    });
  });

  it('accepts a code this client doesn’t know yet, and a missing requestId or details', () => {
    expect(ErrorEnvelope.safeParse({ error: { code: 'FUTURE_CODE', message: 'x' } }).success).toBe(
      true,
    );
  });

  it('rejects bodies that are not envelopes', () => {
    expect(ErrorEnvelope.safeParse({ ok: false, db: 'down' }).success).toBe(false);
    expect(ErrorEnvelope.safeParse({ error: { code: 1, message: 'x' } }).success).toBe(false);
  });
});

describe('toValidationDetails', () => {
  it('keeps the path to each bad field, so forms can highlight it', () => {
    const schema = z.strictObject({ payers: z.array(z.strictObject({ amount: z.int().min(1) })) });
    const result = schema.safeParse({ payers: [{ amount: 5 }, { amount: 0 }], extra: true });
    expect(result.success).toBe(false);
    const details = toValidationDetails(result.error!);
    expect(ValidationFailedDetails.parse(details)).toEqual(details);
    expect(details.issues.map((i) => [i.path, i.code])).toEqual([
      [['payers', 1, 'amount'], 'too_small'],
      [[], 'unrecognized_keys'],
    ]);
  });

  it('stringifies symbol keys, which JSON cannot carry', () => {
    const key = Symbol('k');
    const error = new z.ZodError([{ code: 'custom', path: [key, 0], message: 'bad', input: 1 }]);
    expect(toValidationDetails(error).issues[0]!.path).toEqual(['Symbol(k)', 0]);
  });
});

describe('VersionConflictDetails', () => {
  it('carries the version to reload', () => {
    expect(VersionConflictDetails.parse({ currentVersion: 4 })).toEqual({ currentVersion: 4 });
    expect(VersionConflictDetails.safeParse({ currentVersion: 0 }).success).toBe(false);
  });
});
