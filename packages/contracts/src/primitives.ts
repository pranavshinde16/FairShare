// Field-level building blocks shared by every request and response schema.
//
// String lengths: JavaScript counts UTF-16 code units, Postgres `length()` counts characters. The
// JavaScript count is never smaller, so anything these schemas accept also passes the DB CHECKs.

import { MAX_AMOUNT_MINOR } from '@fairshare/core';
import { z } from 'zod';

/** Every ID is a UUID. Creates take a client-generated UUIDv7, which makes retries idempotent. */
export const Uuid = z.uuid();

/** ISO 4217 code such as "INR". Whether it's supported is checked against the currencies table. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'Expected a 3-letter currency code');

/** A calendar date with no time zone: "2026-11-05". Impossible dates such as Feb 30 are rejected. */
export const IsoDate = z.iso.date();

/** An instant in UTC: "2026-11-05T10:00:00.000Z". */
export const Timestamp = z.iso.datetime();

/** A positive amount in minor units, at most the cap. Every stored amount is one of these (I10). */
export const Amount = z.int().min(1).max(MAX_AMOUNT_MINOR);

/** A signed amount in minor units, such as a net balance. */
export const SignedAmount = z.int();

/** Money in JSON: an integer in minor units plus its currency. Never a formatted string. */
export const Money = z.object({ amount: SignedAmount, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

/** One person's part of a transaction: what they paid, or their share. Mirrors core's Line. */
export const Line = z.strictObject({ userId: Uuid, amount: Amount });
export type Line = z.infer<typeof Line>;

/** A signed per-person amount, such as a net balance. */
export const NetLine = z.object({ userId: Uuid, amount: SignedAmount });

/** Optimistic-concurrency version of a transaction (an `integer` column, starting at 1). */
export const Version = z.int().min(1).max(2_147_483_647);

/** A display name for a person: trimmed, 1–60 characters (users.name CHECK). */
export const PersonName = z.string().trim().min(1).max(60);

/** An email address, trimmed. Case is irrelevant because the column is citext. */
export const Email = z.string().trim().pipe(z.email().max(254));

// ---- occurredOn ---------------------------------------------------------------------------------

/** No expense can be dated before this. */
export const EARLIEST_OCCURRED_ON = '2000-01-01';

/** How far into the future an expense can be dated. The UI warns about any future date. */
export const MAX_DAYS_AHEAD = 365;

/**
 * The date an expense happened. The lower bound is static; the upper bound needs today's date in
 * the user's time zone, so the service checks it separately with `latestOccurredOn`.
 */
export const OccurredOn = IsoDate.refine((date) => date >= EARLIEST_OCCURRED_ON, {
  message: `Date must be on or after ${EARLIEST_OCCURRED_ON}`,
});

/** The latest allowed occurredOn for a given `today` ("YYYY-MM-DD"): today + MAX_DAYS_AHEAD. */
export function latestOccurredOn(today: string): string {
  if (!IsoDate.safeParse(today).success) throw new TypeError(`Invalid date: ${today}`);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + MAX_DAYS_AHEAD);
  return date.toISOString().slice(0, 10);
}
