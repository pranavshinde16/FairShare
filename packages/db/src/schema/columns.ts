// Column helpers shared by the domain tables.

import { bigint, char, customType, timestamp } from 'drizzle-orm/pg-core';

/** Case-insensitive text (the citext extension), for emails. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** An amount in minor units. bigint in Postgres, a safe-integer number in TypeScript. */
export const money = (name: string) => bigint(name, { mode: 'number' });

/** An ISO 4217 code, referencing currencies(code). */
export const currencyCode = (name: string) => char(name, { length: 3 });

/** An instant, stored with time zone. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** created_at, defaulting to now(). */
export const createdAt = () => timestamptz('created_at').notNull().defaultNow();
