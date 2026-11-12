import { describe, expect, it } from 'vitest';
import {
  defaultMethod,
  defaultPair,
  methodLabel,
  overpayment,
  overpaymentMessage,
  paymentSentence,
  suggestedAmount,
  withoutSettlement,
} from './payment';

// The Goa example after the three expenses (Blueprint 5.3): A +1,850, B −950, C −150, D −750.
const [A, B, C, D] = ['a', 'b', 'c', 'd'];
const goa = new Map([
  [A, 185_000],
  [B, -95_000],
  [C, -15_000],
  [D, -75_000],
]);
const transfers = [
  { from: B, to: A, amount: 95_000 },
  { from: D, to: A, amount: 75_000 },
  { from: C, to: A, amount: 15_000 },
];
const money = (amount: number) => `₹${(amount / 100).toFixed(2)}`;

describe('overpayment', () => {
  it('is nothing for the suggested payment, or less (a partial payment)', () => {
    expect(overpayment(goa, B, A, 95_000)).toBeNull();
    expect(overpayment(goa, B, A, 1)).toBeNull();
  });

  it('is past the payer’s debt: “₹200 more than Bilal owes”', () => {
    expect(overpayment(goa, B, A, 115_000)).toEqual({
      side: 'payer',
      limit: 95_000,
      excess: 20_000,
    });
  });

  it('is anything from someone who owes nothing', () => {
    expect(overpayment(goa, A, B, 100)).toEqual({ side: 'payer', limit: 0, excess: 100 });
  });

  it('is past what the recipient is owed, even within the payer’s debt', () => {
    // Bilal owes ₹950 but Chitra is owed nothing: paying her flips her to owing.
    expect(overpayment(goa, B, C, 10_000)).toEqual({
      side: 'recipient',
      limit: 0,
      excess: 10_000,
    });
    const owedLittle = new Map([...goa, [C, 5_000]]);
    expect(overpayment(owedLittle, B, C, 8_000)).toEqual({
      side: 'recipient',
      limit: 5_000,
      excess: 3_000,
    });
  });

  it('is fine paying someone other than suggested, while neither side flips', () => {
    // Dev pays Asha what Bilal was meant to: both still within their balances.
    expect(overpayment(goa, D, A, 75_000)).toBeNull();
  });

  it('counts people missing from the nets as settled', () => {
    expect(overpayment(new Map(), A, B, 1)).toEqual({ side: 'payer', limit: 0, excess: 1 });
  });
});

describe('withoutSettlement', () => {
  it('takes a stored payment back out, so an edit is checked against the balances before it', () => {
    // After Bilal paid Asha ₹950: A +900, B 0.
    const after = new Map([...goa, [A, 90_000], [B, 0]]);
    const before = withoutSettlement(after, { fromUserId: B, toUserId: A, amount: 95_000 });
    expect(before).toEqual(goa);
    expect(after.get(A)).toBe(90_000); // not changed in place
    // Editing it to ₹950 again is no overpayment; ₹1,000 is ₹50 more than Bilal owes.
    expect(overpayment(before, B, A, 95_000)).toBeNull();
    expect(overpayment(before, B, A, 100_000)).toMatchObject({ excess: 5_000 });
  });

  it('handles people the nets leave out', () => {
    expect(withoutSettlement(new Map(), { fromUserId: A, toUserId: B, amount: 5 })).toEqual(
      new Map([
        [A, -5],
        [B, 5],
      ]),
    );
  });
});

describe('overpaymentMessage', () => {
  const bilal = { id: B, meId: A, name: 'Bilal' };
  const me = { id: A, meId: A, name: 'Asha' };

  it.each([
    [
      { side: 'payer', limit: 95_000, excess: 20_000 },
      bilal,
      'This is ₹200.00 more than Bilal owes.',
    ],
    [{ side: 'payer', limit: 95_000, excess: 20_000 }, me, 'This is ₹200.00 more than you owe.'],
    [{ side: 'payer', limit: 0, excess: 100 }, bilal, 'Bilal doesn’t owe anything here.'],
    [{ side: 'payer', limit: 0, excess: 100 }, me, 'You don’t owe anything here.'],
    [
      { side: 'recipient', limit: 5_000, excess: 3_000 },
      bilal,
      'This is ₹30.00 more than Bilal is owed.',
    ],
    [
      { side: 'recipient', limit: 5_000, excess: 3_000 },
      me,
      'This is ₹30.00 more than you’re owed.',
    ],
    [{ side: 'recipient', limit: 0, excess: 1 }, bilal, 'Bilal isn’t owed anything here.'],
    [{ side: 'recipient', limit: 0, excess: 1 }, me, 'You aren’t owed anything here.'],
  ] as const)('%o for %o', (over, person, expected) => {
    expect(overpaymentMessage(over, person, money)).toBe(expected);
  });
});

describe('suggestedAmount and defaultPair', () => {
  it('finds the suggested payment between two people, in that direction only', () => {
    expect(suggestedAmount(transfers, B, A)).toBe(95_000);
    expect(suggestedAmount(transfers, A, B)).toBeNull();
  });

  it('opens on what I pay, then on what I’m paid, then on me paying someone', () => {
    expect(defaultPair(transfers, D, [A, B, C, D])).toEqual({ from: D, to: A });
    expect(defaultPair(transfers, A, [A, B, C, D])).toEqual({ from: B, to: A });
    expect(defaultPair([], C, [A, B, C, D])).toEqual({ from: C, to: A });
    expect(defaultPair([], A, [A, B])).toEqual({ from: A, to: B });
    // Alone in the group: the form shows the problem rather than guessing.
    expect(defaultPair([], A, [A])).toEqual({ from: A, to: A });
  });
});

describe('words', () => {
  const nameOf = (id: string) => (id === A ? 'You' : ({ b: 'Bilal', c: 'Chitra' }[id] ?? '?'));

  it('says who paid whom from my side', () => {
    expect(paymentSentence(B, A, A, nameOf)).toBe('Bilal paid you');
    expect(paymentSentence(A, B, A, nameOf)).toBe('You paid Bilal');
    expect(paymentSentence(B, C, A, nameOf)).toBe('Bilal paid Chitra');
  });

  it('labels methods and picks a default', () => {
    expect(methodLabel('bank_transfer')).toBe('Bank');
    expect(methodLabel('upi')).toBe('UPI');
    expect(defaultMethod('INR')).toBe('upi');
    expect(defaultMethod('USD')).toBe('cash');
  });
});
