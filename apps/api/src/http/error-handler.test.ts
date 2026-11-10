import { ErrorEnvelope, ValidationFailedDetails } from '@fairshare/contracts';
import { computeShares } from '@fairshare/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testApp } from '../testing/app';
import { INTERNAL_MESSAGE } from './error-handler';
import { AppError } from './errors';
import { validate } from './validate';

const Body = z.strictObject({ name: z.string().min(1), amount: z.int().positive() });

/** An app with routes that fail in each of the ways the error handler must cover. */
function appWithFailingRoutes() {
  const t = testApp();
  t.app
    .get('/api/test/app-error', () => {
      throw new AppError('VERSION_CONFLICT', 'Someone else edited this.', { currentVersion: 3 });
    })
    .get('/api/test/domain-error', () => {
      computeShares(100, { method: 'exact', amounts: [{ userId: 'a', amount: 99 }] }, 'seed');
      throw new Error('unreachable');
    })
    .post('/api/test/body', validate('json', Body), (c) => c.json(c.req.valid('json')))
    .get(
      '/api/test/query',
      validate('query', z.object({ limit: z.coerce.number().max(100) })),
      (c) => c.json(c.req.valid('query')),
    )
    .get('/api/test/crash', () => {
      throw new Error('connection string postgres://secret@db leaked');
    });
  return t;
}

const postJson = (body: string, contentType = 'application/json') => ({
  method: 'POST',
  body,
  headers: { 'Content-Type': contentType },
});

async function envelope(res: Response) {
  const { error } = ErrorEnvelope.parse(await res.json());
  expect(error.requestId).toBe(res.headers.get('X-Request-Id'));
  return error;
}

describe('the error handler', () => {
  it('sends an AppError with the status from the contracts table', async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request('/api/test/app-error');

    expect(res.status).toBe(409);
    expect(await envelope(res)).toMatchObject({
      code: 'VERSION_CONFLICT',
      message: 'Someone else edited this.',
      details: { currentVersion: 3 },
    });
  });

  it("sends core's DomainError as 422 with its code and details", async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request('/api/test/domain-error');

    expect(res.status).toBe(422);
    expect(await envelope(res)).toMatchObject({
      code: 'SPLIT_SUM_MISMATCH',
      details: { expected: 100, actual: 99 },
    });
  });

  it('turns a schema failure into VALIDATION_FAILED with a path for each problem', async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request(
      '/api/test/body',
      postJson(JSON.stringify({ name: '', amount: 1.5, extra: true })),
    );

    expect(res.status).toBe(400);
    const error = await envelope(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    const { issues } = ValidationFailedDetails.parse(error.details);
    expect(issues.map((i) => i.path)).toEqual([['name'], ['amount'], []]);
    expect(issues[2]!.code).toBe('unrecognized_keys');
  });

  it('validates query strings the same way', async () => {
    const { app } = appWithFailingRoutes();

    const ok = await app.request('/api/test/query?limit=30');
    const bad = await app.request('/api/test/query?limit=500');

    expect(await ok.json()).toEqual({ limit: 30 });
    expect(bad.status).toBe(400);
    expect((await envelope(bad)).code).toBe('VALIDATION_FAILED');
  });

  it('passes valid input through to the route', async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request('/api/test/body', postJson('{"name":"Dinner","amount":1200}'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Dinner', amount: 1200 });
  });

  it('rejects malformed JSON as VALIDATION_FAILED', async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request('/api/test/body', postJson('{"name":'));

    expect(res.status).toBe(400);
    expect(await envelope(res)).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Malformed JSON in request body',
    });
  });

  it('accepts only JSON bodies: a form-encoded body is read as empty and fails', async () => {
    const { app } = appWithFailingRoutes();

    const res = await app.request(
      '/api/test/body',
      postJson('name=Dinner&amount=1200', 'application/x-www-form-urlencoded'),
    );

    expect(res.status).toBe(400);
    expect((await envelope(res)).code).toBe('VALIDATION_FAILED');
  });

  it('hides the cause of an unexpected error, and logs and reports it instead', async () => {
    const { app, deps, logs } = appWithFailingRoutes();

    const res = await app.request('/api/test/crash');

    expect(res.status).toBe(500);
    const error = await envelope(res);
    expect(error).toEqual({
      code: 'INTERNAL',
      message: INTERNAL_MESSAGE,
      requestId: error.requestId,
    });

    expect(deps.reportError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      requestId: error.requestId,
    });
    const [unhandled, summary] = logs;
    expect(unhandled).toMatchObject({
      level: 50,
      msg: 'unhandled error',
      requestId: error.requestId,
      err: { message: expect.stringContaining('leaked') as string },
    });
    expect(summary).toMatchObject({ level: 50, msg: 'request failed', status: 500 });
  });

  it('does not report errors the client caused', async () => {
    const { app, deps } = appWithFailingRoutes();

    await app.request('/api/test/app-error');
    await app.request('/api/test/domain-error');
    await app.request('/api/test/body', postJson('{}'));

    expect(deps.reportError).not.toHaveBeenCalled();
  });
});
