import type { PaymentMethod, Transfer } from '@fairshare/contracts';

/** The method buttons, in the plan's order (Blueprint 7.2: UPI / Cash / Bank / Other). */
export const PAYMENT_METHODS: [PaymentMethod, string][] = [
  ['upi', 'UPI'],
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank'],
  ['other', 'Other'],
];

export const methodLabel = (method: PaymentMethod) =>
  PAYMENT_METHODS.find(([m]) => m === method)![1];

/** A fresh form's method: UPI where it's the everyday way to pay (rupees), cash elsewhere. */
export const defaultMethod = (currency: string): PaymentMethod =>
  currency === 'INR' ? 'upi' : 'cash';

type Names = (userId: string) => string;

/** "Bilal paid Asha", "You paid Asha", "Bilal paid you". `nameOf(me)` is "You". */
export function paymentSentence(from: string, to: string, meId: string, nameOf: Names): string {
  return `${nameOf(from)} paid ${to === meId ? 'you' : nameOf(to)}`;
}

/** Group nets by person (+ owed, − owes), for one currency. */
export type Nets = ReadonlyMap<string, number>;

/**
 * The nets as they'd be without a stored settlement, so editing one is checked against the
 * balances before it: its payer had been credited the amount, its recipient debited.
 */
export function withoutSettlement(
  nets: Nets,
  settlement: { fromUserId: string; toUserId: string; amount: number },
): Nets {
  const result = new Map(nets);
  const add = (userId: string, amount: number) =>
    result.set(userId, (result.get(userId) ?? 0) + amount);
  add(settlement.fromUserId, -settlement.amount);
  add(settlement.toUserId, settlement.amount);
  return result;
}

export type Overpayment = {
  /** Whose side the payment goes past: the payer's debt, or what the recipient is owed. */
  side: 'payer' | 'recipient';
  /** What they owe (payer) or are owed (recipient) now; 0 if nothing. */
  limit: number;
  excess: number;
};

/**
 * Whether a payment goes past what's outstanding (Blueprint 4.8: "This is ₹200 more than Rahul
 * owes. Record anyway?"). It's allowed, but the direction then flips, so the form asks first.
 *
 * The payment is checked against both people's balances in the group: paying more than the payer
 * owes leaves the payer owed; paying someone more than they're owed leaves them owing. Paying a
 * different person than the suggestions say is fine as long as neither happens: the suggestions
 * re-route around it.
 */
export function overpayment(
  nets: Nets,
  fromUserId: string,
  toUserId: string,
  amount: number,
): Overpayment | null {
  const owes = Math.max(0, -(nets.get(fromUserId) ?? 0));
  if (amount > owes) return { side: 'payer', limit: owes, excess: amount - owes };
  const owed = Math.max(0, nets.get(toUserId) ?? 0);
  if (amount > owed) return { side: 'recipient', limit: owed, excess: amount - owed };
  return null;
}

/** The overpayment question in words: "This is ₹200.00 more than Bilal owes." */
export function overpaymentMessage(
  over: Overpayment,
  person: { id: string; meId: string; name: string },
  money: (amount: number) => string,
): string {
  const me = person.id === person.meId;
  if (over.side === 'payer') {
    if (over.limit === 0) {
      return me ? 'You don’t owe anything here.' : `${person.name} doesn’t owe anything here.`;
    }
    return `This is ${money(over.excess)} more than ${me ? 'you owe' : `${person.name} owes`}.`;
  }
  if (over.limit === 0) {
    return me ? 'You aren’t owed anything here.' : `${person.name} isn’t owed anything here.`;
  }
  return `This is ${money(over.excess)} more than ${me ? 'you’re' : `${person.name} is`} owed.`;
}

/** The suggested payment from one person to the other, if the group's suggestions have one. */
export function suggestedAmount(
  transfers: readonly Transfer[],
  fromUserId: string,
  toUserId: string,
): number | null {
  return transfers.find((t) => t.from === fromUserId && t.to === toUserId)?.amount ?? null;
}

/**
 * Who a payment is between when the form opens without a suggestion picked ("Record a payment"):
 * my own suggested payment (what I pay first, then what I'm paid), else me paying the first other
 * active member.
 */
export function defaultPair(
  transfers: readonly Transfer[],
  meId: string,
  activeIds: readonly string[],
): { from: string; to: string } {
  const mine =
    transfers.find((t) => t.from === meId) ?? transfers.find((t) => t.to === meId) ?? null;
  if (mine) return { from: mine.from, to: mine.to };
  return { from: meId, to: activeIds.find((id) => id !== meId) ?? meId };
}
