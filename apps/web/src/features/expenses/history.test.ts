import type { ActivityEntry } from '@fairshare/contracts';
import { describe, expect, it } from 'vitest';
import { changeLines, describeEntry, entryHeadline } from './history';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
const C = '01900000-0000-7000-8000-00000000000c';
const ASHA = { id: A, name: 'Asha', avatarUrl: null, isPlaceholder: false, isDeleted: false };
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
    unread: false,
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

  it('reads removals as their own verb, not after “changed”', () => {
    const before = snapshot({ notes: 'Tip included' });
    expect(describeEntry(entry('transaction.updated', before, snapshot()), name, money)).toBe(
      'Asha removed the notes',
    );
    expect(
      describeEntry(
        entry(
          'transaction.updated',
          before,
          snapshot({
            amount: 1200,
            payers: [{ userId: A, amount: 1200 }],
            shares: [
              { userId: A, amount: 600 },
              { userId: B, amount: 600 },
            ],
          }),
        ),
        name,
        money,
      ),
    ).toBe(
      'Asha changed the amount ₹10.00 → ₹12.00, Asha’s payment ₹10.00 → ₹12.00, Asha’s share ₹5.00 → ₹6.00, Bilal’s share ₹5.00 → ₹6.00 and removed the notes',
    );
  });

  it('says “your” when the reader is named “you”', () => {
    const you = (id: string) => (id === A ? 'you' : name(id));
    const after = snapshot({ amount: 1200, payers: [{ userId: A, amount: 1200 }] });
    expect(describeEntry(entry('transaction.updated', snapshot(), after), you, money)).toContain(
      'your payment ₹10.00 → ₹12.00',
    );
  });

  describe('a payment', () => {
    // Bilal paid Asha ₹9.50 by UPI.
    const payment = (overrides: Record<string, unknown> = {}) =>
      snapshot({
        description: 'Settlement',
        amount: 950,
        splitMethod: null,
        splitInput: null,
        payers: [{ userId: B, amount: 950 }],
        shares: [{ userId: A, amount: 950 }],
        paymentMethod: 'upi',
        paymentRef: null,
        ...overrides,
      });

    it('is recorded rather than added', () => {
      expect(describeEntry(entry('transaction.created', null, payment()), name, money)).toBe(
        'Asha recorded it',
      );
      expect(describeEntry(entry('transaction.deleted', payment(), null), name, money)).toBe(
        'Asha deleted it',
      );
    });

    it('reads its amount once, not as a payment and a share as well', () => {
      const after = payment({
        amount: 1000,
        payers: [{ userId: B, amount: 1000 }],
        shares: [{ userId: A, amount: 1000 }],
      });
      expect(describeEntry(entry('transaction.updated', payment(), after), name, money)).toBe(
        'Asha changed the amount ₹9.50 → ₹10.00',
      );
    });

    it('names a new payer, recipient, method and reference', () => {
      const after = payment({
        payers: [{ userId: C, amount: 950 }],
        shares: [{ userId: B, amount: 950 }],
        paymentMethod: 'bank_transfer',
        paymentRef: 'NEFT 77',
      });
      expect(describeEntry(entry('transaction.updated', payment(), after), name, money)).toBe(
        'Asha changed the method to Bank, the reference to “NEFT 77”, who paid to Chitra and who was paid to Bilal',
      );
    });

    it('reads a cleared reference as removed', () => {
      expect(
        describeEntry(
          entry('transaction.updated', payment({ paymentRef: 'R1' }), payment()),
          name,
          money,
        ),
      ).toBe('Asha removed the reference');
    });
  });

  it('falls back gracefully on a snapshot it can’t read', () => {
    expect(describeEntry(entry('transaction.updated', { odd: true }, null), name, money)).toBe(
      'Asha edited it',
    );
  });
});

describe('history as a timeline (DESIGN_SPEC §6.3)', () => {
  it('heads each entry with who did what', () => {
    expect(entryHeadline(entry('transaction.created', null, snapshot()))).toBe('Asha added it');
    expect(entryHeadline(entry('transaction.updated', snapshot(), snapshot()))).toBe(
      'Asha changed it',
    );
    expect(entryHeadline(entry('transaction.deleted', snapshot(), null))).toBe('Asha deleted it');
  });

  it('lists each change on its own line, with what it was and what it is', () => {
    const before = snapshot();
    const after = snapshot({
      amount: 1200,
      notes: 'Sea view',
      payers: [{ userId: A, amount: 1200 }],
      shares: [
        { userId: A, amount: 400 },
        { userId: B, amount: 400 },
        { userId: C, amount: 400 },
      ],
    });
    const you = (id: string) => (id === A ? 'you' : name(id));
    expect(changeLines(before, after, you, money)).toEqual([
      { label: 'Amount', from: '₹10.00', to: '₹12.00' },
      { label: 'Notes added' },
      { label: 'Your payment', from: '₹10.00', to: '₹12.00' },
      { label: 'Your share', from: '₹5.00', to: '₹4.00' },
      { label: 'Bilal’s share', from: '₹5.00', to: '₹4.00' },
      { label: 'Added Chitra to the split' },
    ]);
  });

  it('is empty when a snapshot can’t be read', () => {
    expect(changeLines(null, snapshot(), name, money)).toEqual([]);
  });
});
