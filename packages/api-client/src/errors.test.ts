import { describe, expect, it } from 'vitest';
import { ApiError, conflictVersion, toApiError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('toApiError', () => {
  it('reads the error envelope', async () => {
    const err = await toApiError(
      json(422, {
        error: {
          code: 'SPLIT_SUM_MISMATCH',
          message: 'Split amounts add up to ₹2,300 but the expense is ₹2,400.',
          details: { expected: 240000, actual: 230000 },
          requestId: 'req-1',
        },
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'SPLIT_SUM_MISMATCH',
      message: 'Split amounts add up to ₹2,300 but the expense is ₹2,400.',
      details: { expected: 240000, actual: 230000 },
      requestId: 'req-1',
    });
  });

  it('maps a code this client doesn’t know to INTERNAL, keeping the message', async () => {
    const err = await toApiError(
      json(418, { error: { code: 'TEAPOT', message: 'Short and stout' } }),
    );
    expect(err).toMatchObject({ status: 418, code: 'INTERNAL', message: 'Short and stout' });
  });

  it.each([
    ['plain text', new Response('Bad Gateway', { status: 502 })],
    ['JSON that isn’t an envelope', json(503, { ok: false, db: 'down' })],
    ['an empty body', new Response(null, { status: 500 })],
  ])('falls back to INTERNAL for %s', async (_label, res) => {
    const err = await toApiError(res);
    expect(err).toMatchObject({
      code: 'INTERNAL',
      message: `Request failed with status ${res.status}`,
    });
    expect(err.details).toBeUndefined();
  });
});

describe('conflictVersion', () => {
  const conflict = (details: unknown) => new ApiError(409, 'VERSION_CONFLICT', 'Changed', details);

  it('returns the version someone else saved', () =>
    expect(conflictVersion(conflict({ currentVersion: 5 }))).toBe(5));

  it('returns null for anything else', () => {
    expect(conflictVersion(conflict(undefined))).toBeNull();
    expect(
      conflictVersion(new ApiError(409, 'ID_CONFLICT', 'x', { currentVersion: 5 })),
    ).toBeNull();
    expect(conflictVersion(new Error('VERSION_CONFLICT'))).toBeNull();
    expect(conflictVersion(null)).toBeNull();
  });
});
