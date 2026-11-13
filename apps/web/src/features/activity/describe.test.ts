import type { ActivityEntry, UserRef } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../lib/relative-time';
import { describeActivity } from './describe';

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, G, T] = [id(1), id(2), id(3), id(9), id(7)];
const user = (userId: string, name: string): UserRef => ({
  id: userId,
  name,
  avatarUrl: null,
  isPlaceholder: false,
});
const asha = user(A, 'Asha');
const bilal = user(B, 'Bilal');
const chitra = user(C, 'Chitra');
const money = (amount: number, currency: string) =>
  `${currency === 'INR' ? '₹' : '$'}${(amount / 100).toFixed(2)}`;
// Read as Asha.
const ctx = { meId: A, people: [asha, bilal, chitra], money };

const entry = (patch: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1,
  groupId: G,
  groupName: 'Goa Trip',
  actor: bilal,
  verb: 'transaction.created',
  entityType: 'transaction',
  entityId: T,
  target: null,
  before: null,
  after: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  involvesMe: false,
  ...patch,
});

// Bilal paid ₹1,200 for dinner, split between Asha, Bilal and Chitra.
const dinner = {
  description: 'Dinner',
  amount: 120_000,
  currency: 'INR',
  occurredOn: '2026-11-10',
  notes: null,
  splitMethod: 'equal',
  splitInput: { method: 'equal', participants: [A, B, C] },
  payers: [{ userId: B, amount: 120_000 }],
  shares: [
    { userId: A, amount: 40_000 },
    { userId: B, amount: 40_000 },
    { userId: C, amount: 40_000 },
  ],
};
// Bilal paid Asha ₹950.
const payment = {
  ...dinner,
  description: 'Settlement',
  amount: 95_000,
  splitMethod: null,
  splitInput: null,
  payers: [{ userId: B, amount: 95_000 }],
  shares: [{ userId: A, amount: 95_000 }],
  paymentMethod: 'upi',
  paymentRef: null,
};
const toTransaction = { to: '/transactions/$id', params: { id: T } };
const toGroup = { to: '/groups/$groupId', params: { groupId: G } };

describe('describeActivity: expenses and payments', () => {
  it('reads an expense being added, with my effect, leading to it', () => {
    expect(describeActivity(entry({ after: dinner }), ctx)).toEqual({
      text: 'Bilal added ‘Dinner’',
      detail: null,
      effect: { text: 'you borrowed ₹400.00', tone: 'owes' },
      link: toTransaction,
    });
  });

  it('says what an edit changed', () => {
    const after = {
      ...dinner,
      amount: 150_000,
      payers: [{ userId: B, amount: 150_000 }],
      shares: [
        { userId: A, amount: 75_000 },
        { userId: B, amount: 75_000 },
      ],
      splitInput: { method: 'equal', participants: [A, B] },
    };
    const line = describeActivity(
      entry({ verb: 'transaction.updated', before: dinner, after, actor: asha }),
      ctx,
    );
    expect(line.text).toBe('You edited ‘Dinner’');
    expect(line.detail).toBe(
      'Changed the amount ₹1200.00 → ₹1500.00, Bilal’s payment ₹1200.00 → ₹1500.00, your share ₹400.00 → ₹750.00, Bilal’s share ₹400.00 → ₹750.00 and removed Chitra from the split',
    );
    expect(line.effect).toEqual({ text: 'you borrowed ₹750.00', tone: 'owes' });
  });

  it('shows no effect for a deletion, and nothing for an expense I’m not in', () => {
    const deleted = describeActivity(entry({ verb: 'transaction.deleted', before: dinner }), ctx);
    expect(deleted).toMatchObject({ text: 'Bilal deleted ‘Dinner’', effect: null });
    const notMine = { ...dinner, shares: [{ userId: B, amount: 120_000 }] };
    expect(describeActivity(entry({ after: notMine }), ctx).effect).toBeNull();
    const lent = describeActivity(
      entry({ actor: asha, after: { ...dinner, payers: [{ userId: A, amount: 120_000 }] } }),
      ctx,
    );
    expect(lent.effect).toEqual({ text: 'you lent ₹800.00', tone: 'owed' });
  });

  it('reads a payment: who paid whom, and what I received', () => {
    expect(describeActivity(entry({ after: payment }), ctx)).toEqual({
      text: 'Bilal recorded a payment',
      detail: 'Bilal paid you ₹950.00',
      effect: { text: 'you received ₹950.00', tone: 'neutral' },
      link: toTransaction,
    });
    const mine = describeActivity(
      entry({
        actor: asha,
        verb: 'transaction.restored',
        after: {
          ...payment,
          payers: [{ userId: A, amount: 95_000 }],
          shares: [{ userId: C, amount: 95_000 }],
        },
      }),
      ctx,
    );
    expect(mine).toMatchObject({
      text: 'You restored a payment',
      detail: 'You paid Chitra ₹950.00',
      effect: { text: 'you paid ₹950.00', tone: 'neutral' },
    });
  });

  it('describes a payment’s edit, falling back to who paid whom', () => {
    const changed = describeActivity(
      entry({
        verb: 'transaction.updated',
        before: payment,
        after: { ...payment, paymentMethod: 'cash' },
      }),
      ctx,
    );
    expect(changed.detail).toBe('Changed the method to Cash');
    const unreadable = describeActivity(
      entry({ verb: 'transaction.updated', before: { odd: true }, after: payment }),
      ctx,
    );
    expect(unreadable).toMatchObject({
      text: 'Bilal edited a payment',
      detail: 'Bilal paid you ₹950.00',
    });
    const deleted = describeActivity(entry({ verb: 'transaction.deleted', before: payment }), ctx);
    expect(deleted).toMatchObject({
      text: 'Bilal deleted a payment',
      detail: 'Bilal paid you ₹950.00',
    });
  });
});

describe('describeActivity: groups, members and invites', () => {
  const group = (patch: Partial<ActivityEntry>) =>
    describeActivity(entry({ entityType: 'group', entityId: G, ...patch }), ctx);

  it.each([
    [{ verb: 'group.created' }, 'Bilal created the group'],
    [
      { verb: 'group.renamed', before: { name: 'Goa' }, after: { name: 'Goa 2026' } },
      'Bilal renamed the group to ‘Goa 2026’',
    ],
    [
      { verb: 'group.updated', before: { emoji: null }, after: { emoji: '🏖️' } },
      'Bilal changed the emoji to 🏖️',
    ],
    [
      { verb: 'group.updated', before: {}, after: { emoji: null, currency: 'USD' } },
      'Bilal changed the emoji to none and the currency to USD',
    ],
    [{ verb: 'group.updated', before: {}, after: {} }, 'Bilal changed the group'],
    [{ verb: 'member.added', target: chitra }, 'Bilal added Chitra'],
    [{ verb: 'member.added', target: asha }, 'Bilal added you'],
    [
      { verb: 'member.added', target: bilal, after: { inviteId: id(5) } },
      'Bilal joined with an invite link',
    ],
    [{ verb: 'member.added', target: bilal }, 'Bilal joined'],
    [{ verb: 'member.removed', target: chitra }, 'Bilal removed Chitra'],
    [{ verb: 'member.left', target: bilal }, 'Bilal left the group'],
    [
      { verb: 'member.claimed', target: bilal, after: { placeholderName: 'Bilal K' } },
      'Bilal joined as Bilal K',
    ],
    [{ verb: 'member.claimed', target: bilal }, 'Bilal joined as a placeholder'],
    [{ verb: 'invite.created' }, 'Bilal created an invite link'],
    [{ verb: 'invite.created', target: chitra }, 'Bilal invited Chitra'],
    [{ verb: 'invite.revoked' }, 'Bilal turned off an invite link'],
    [{ verb: 'invite.revoked', target: chitra }, 'Bilal turned off Chitra’s invite link'],
  ] as [Partial<ActivityEntry>, string][])('%j', (patch, text) => {
    expect(group(patch)).toMatchObject({ text, link: toGroup, effect: null });
  });

  it('leads nowhere once the group is gone to me', () => {
    expect(group({ verb: 'group.deleted', before: { name: 'Goa Trip' } })).toMatchObject({
      text: 'Bilal deleted the group ‘Goa Trip’',
      link: null,
    });
    expect(group({ verb: 'member.removed', target: asha })).toMatchObject({
      text: 'Bilal removed you',
      link: null,
    });
    expect(group({ verb: 'member.left', actor: asha, target: asha })).toMatchObject({
      text: 'You left the group',
      link: null,
    });
  });

  it('names a new owner when the owner leaves', () => {
    expect(group({ verb: 'member.left', after: { newOwnerId: C } }).detail).toBe(
      'Chitra is now the owner',
    );
    expect(group({ verb: 'member.left', after: { newOwnerId: A } }).detail).toBe(
      'You are now the owner',
    );
  });

  it('reads a friendship starting, and leads to the friend', () => {
    const friendship = (patch: Partial<ActivityEntry>) =>
      describeActivity(entry({ verb: 'member.added', groupName: null, ...patch }), ctx);
    expect(friendship({ actor: bilal, target: asha })).toMatchObject({
      text: 'Bilal added you as a friend',
      link: { to: '/friends/$userId', params: { userId: B } },
    });
    expect(friendship({ actor: asha, target: chitra })).toMatchObject({
      text: 'You added Chitra as a friend',
      link: { to: '/friends/$userId', params: { userId: C } },
    });
  });

  it('falls back on someone it doesn’t know', () => {
    const stranger = user(id(8), 'Dev');
    expect(group({ verb: 'member.removed', target: stranger }).text).toBe('Bilal removed Dev');
    const unknownPayer = { ...payment, payers: [{ userId: id(6), amount: 95_000 }] };
    expect(describeActivity(entry({ after: unknownPayer }), ctx).detail).toBe(
      'Someone paid you ₹950.00',
    );
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 10, 12, 10, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it.each([
    [ago(10_000), 'just now'],
    [ago(5 * 60_000), '5 minutes ago'],
    [ago(3 * 3_600_000), '3 hours ago'],
    [new Date(2026, 10, 11, 23, 0).toISOString(), '11 hours ago'],
    [new Date(2026, 10, 11, 8, 0).toISOString(), 'yesterday'],
    [new Date(2026, 10, 8, 12, 0).toISOString(), '4 days ago'],
    [new Date(2026, 10, 3, 12, 0).toISOString(), 'Nov 3'],
    [new Date(2025, 11, 31, 12, 0).toISOString(), 'Dec 31, 2025'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now, 'en-US')).toBe(expected);
  });
});
