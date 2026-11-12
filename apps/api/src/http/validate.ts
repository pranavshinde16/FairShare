import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z, type ZodType } from 'zod';

/**
 * Validates one part of the request (json, query, param, header) against a contracts schema.
 * A failure is thrown, so the error handler answers with the usual VALIDATION_FAILED envelope.
 * A JSON body sent without a JSON content type is read as {} and fails the schema.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    // ZodRealError, not ZodError: in zod 4 only the former is an Error, and Hono passes only Errors
    // to the error handler. It still matches `instanceof z.ZodError` there.
    if (!result.success) throw new z.ZodRealError(result.error.issues);
  });
}

/**
 * Parses a body already read as JSON against a schema chosen later (PUT /transactions/:id picks
 * the expense or settlement shape by the stored transaction's type). A failure is the same
 * VALIDATION_FAILED as validate() gives.
 */
export function parseBody<Schema extends ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) throw new z.ZodRealError(result.error.issues);
  return result.data;
}
