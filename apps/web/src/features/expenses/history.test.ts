import type { ActivityEntry } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { describeEntry } from './history';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const C = '01900000-0000-7000-8000-00000000000c';
const ASHA = { id: A, name: 'Asha', avatarUrl: null, isPlaceholder: false };
const names: Record<string, string> = { [A]: 'Asha', [B]: 'Bilal', [C]: 'Chitra' };
const name = (id: string) => names[id] ?? 'someone';
const money = (amount: number) => `₹${(amount / 100).toFixed(2)}`;

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  description: 'Dinner',
  amount: 1000,
  currency: 'INR',
  occurredOn: '2026-11-10',
  notes: null,
  splitMethod: 'equal',
  splitInput: null,
  payers: [{ userId: A, amount: 1000 }],
  shares: [
    { userId: A, amount: 500 },
    { userId: B, amount: 500 },
  ],
  ...overrides,
});

const entry = (verb: ActivityEntry['verb'], before: unknown, after: unknown): ActivityEntry =>
  ({
    id: 1,
    groupId: 'g',
    groupName: 'Goa',
    actor: ASHA,
    verb,
    entityType: 'transaction',
    entityId: 't',
    target: null,
    before,
    after,
    createdAt: '2026-11-10T10:00:00.000Z',
    involvesMe: true,
  }) as ActivityEntry;

describe('describeEntry', () => {
  it('names creating, deleting and restoring', () => {
    expect(describeEntry(entry('transaction.created', null, snapshot()), name, money)).toBe(
      'Asha added it',
    );
    expect(describeEntry(entry('transaction.deleted', snapshot(), null), name, money)).toBe(
      'Asha deleted it',
    );
    expect(describeEntry(entry('transaction.restored', null, snapshot()), name, money)).toBe(
      'Asha restored it',
    );
  });

  it('lists what an edit changed, in plain words', () => {
    const after = snapshot({
      amount: 1500,
      description: 'Dinner at Thalassa',
      payers: [{ userId: A, amount: 1500 }],
      shares: [
        { userId: A, amount: 500 },
        { userId: B, amount: 500 },
        { userId: C, amount: 500 },
      ],
    });
    expect(describeEntry(entry('transaction.updated', snapshot(), after), name, money)).toBe(
      'Asha changed the description to “Dinner at Thalassa”, the amount ₹10.00 → ₹15.00, Asha’s payment ₹10.00 → ₹15.00 and added Chitra to the split',
    );
  });

  it('falls back gracefully on a snapshot it can’t read', () => {
    expect(describeEntry(entry('transaction.updated', { odd: true }, null), name, money)).toBe(
      'Asha edited it',
    );
  });
});
