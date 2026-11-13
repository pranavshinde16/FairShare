// Valid example payloads for the schema tests, based on the plan's Goa trip. Test-only.

import type { z } from 'zod';
import { expect } from 'vitest';

/** A valid UUIDv7-shaped ID that's easy to recognize in failures. */
export const uuid = (suffix: string) => `01900000-0000-7000-8000-${suffix.padStart(12, '0')}`;

export const ids = {
  a: uuid('a'),
  b: uuid('b'),
  c: uuid('c'),
  d: uuid('d'),
  group: uuid('100'),
  direct: uuid('101'),
  dinner: uuid('200'),
  settlement: uuid('201'),
  invite: uuid('300'),
};

export const userRef = (id: string, name: string) => ({
  id,
  name,
  avatarUrl: null,
  isPlaceholder: false,
  isDeleted: false,
});

export const at = '2026-11-05T10:00:00.000Z';

export const member = (id: string, name: string, role: 'owner' | 'member' = 'member') => ({
  user: userRef(id, name),
  role,
  joinedAt: at,
  leftAt: null,
});

export const group = {
  id: ids.group,
  kind: 'group',
  name: 'Goa Trip',
  emoji: '🏖️',
  currency: 'INR',
  createdAt: at,
  members: [
    member(ids.a, 'Asha', 'owner'),
    member(ids.b, 'Bilal'),
    member(ids.c, 'Chitra'),
    member(ids.d, 'Dev'),
  ],
  myRole: 'owner',
};

export const directGroup = {
  ...group,
  id: ids.direct,
  kind: 'direct',
  name: null,
  emoji: null,
  members: [member(ids.a, 'Asha'), member(ids.b, 'Bilal')],
  myRole: 'member',
};

/** Dinner for four, ₹1,200 paid by Bilal, split equally. */
export const createExpense = {
  id: ids.dinner,
  description: 'Dinner',
  amount: 120_000,
  currency: 'INR',
  occurredOn: '2026-11-05',
  payers: [{ userId: ids.b, amount: 120_000 }],
  split: { method: 'equal', participants: [ids.a, ids.b, ids.c, ids.d] },
};

export const expenseTransaction = {
  id: ids.dinner,
  groupId: ids.group,
  type: 'expense',
  description: 'Dinner',
  notes: null,
  amount: 120_000,
  currency: 'INR',
  occurredOn: '2026-11-05',
  splitMethod: 'equal',
  splitInput: createExpense.split,
  payers: [{ userId: ids.b, amount: 120_000 }],
  shares: [ids.a, ids.b, ids.c, ids.d].map((userId) => ({ userId, amount: 30_000 })),
  paymentMethod: null,
  paymentRef: null,
  createdBy: userRef(ids.b, 'Bilal'),
  updatedBy: null,
  createdAt: at,
  updatedAt: null,
  deletedAt: null,
  version: 1,
  myNet: -30_000,
};

/** Bilal pays Asha ₹950 by UPI. */
export const createSettlement = {
  id: ids.settlement,
  fromUserId: ids.b,
  toUserId: ids.a,
  amount: 95_000,
  currency: 'INR',
  occurredOn: '2026-11-06',
  method: 'upi',
  reference: '431298765012',
};

export const settlementTransaction = {
  ...expenseTransaction,
  id: ids.settlement,
  type: 'settlement',
  description: 'Settlement',
  amount: 95_000,
  occurredOn: '2026-11-06',
  splitMethod: null,
  splitInput: null,
  payers: [{ userId: ids.b, amount: 95_000 }],
  shares: [{ userId: ids.a, amount: 95_000 }],
  paymentMethod: 'upi',
  paymentRef: '431298765012',
  myNet: -95_000,
};

export const activityEntry = {
  id: 42,
  groupId: ids.group,
  groupName: 'Goa Trip',
  actor: userRef(ids.b, 'Bilal'),
  verb: 'transaction.created',
  entityType: 'transaction',
  entityId: ids.dinner,
  target: null,
  before: null,
  after: { description: 'Dinner', amount: 120_000 },
  createdAt: at,
  involvesMe: true,
};

/** `{ ...base, ...patch }`, for one-field-off invalid fixtures. */
export const withField = (base: object, patch: Record<string, unknown>) => ({ ...base, ...patch });

/** Parses and fails the test with the zod issues if the value is rejected. */
export function expectValid<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) expect.fail(JSON.stringify(result.error.issues, null, 2));
  return result.data;
}

/** The paths of every issue when the value is rejected (fails the test if it's accepted). */
export function rejectedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) expect.fail(`Expected rejection, got ${JSON.stringify(result.data)}`);
  return result.error.issues.map((issue) => issue.path.join('.'));
}
