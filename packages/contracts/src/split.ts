import { BASIS_POINTS_TOTAL, MAX_AMOUNT_MINOR, MAX_SHARES_PER_PERSON } from '@fairshare/core';
import { z } from 'zod';
import { Uuid } from './primitives';

/** Most people who can pay for, or share in, one transaction. */
export const MAX_PEOPLE_PER_TRANSACTION = 50;

export const SplitMethod = z.enum(['equal', 'exact', 'percent', 'shares']);
export type SplitMethod = z.infer<typeof SplitMethod>;

const people = <T extends z.ZodType>(entry: T) =>
  z.array(entry).min(1).max(MAX_PEOPLE_PER_TRANSACTION);

/**
 * How the user asked for the cost to be divided (core's SplitInput). zod checks shape and the range
 * of each entry; core checks the rest: sums, duplicate users and at least one participant with a
 * non-zero part. Zero entries are allowed so the editor can list everyone.
 */
export const SplitInput = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('equal'), participants: people(Uuid) }),
  z.strictObject({
    method: z.literal('exact'),
    amounts: people(z.strictObject({ userId: Uuid, amount: z.int().min(0).max(MAX_AMOUNT_MINOR) })),
  }),
  z.strictObject({
    method: z.literal('percent'),
    // Basis points: 33.33% is 3333. They must add up to 10,000.
    basisPoints: people(
      z.strictObject({ userId: Uuid, bp: z.int().min(0).max(BASIS_POINTS_TOTAL) }),
    ),
  }),
  z.strictObject({
    method: z.literal('shares'),
    shares: people(
      z.strictObject({ userId: Uuid, shares: z.int().min(0).max(MAX_SHARES_PER_PERSON) }),
    ),
  }),
]);
export type SplitInput = z.infer<typeof SplitInput>;
