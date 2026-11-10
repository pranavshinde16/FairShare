// The worked example from the plan (§5.3 and §5.6), in paise. A Goa trip with A, B, C and D.
import type { LedgerTransaction } from '../ledger/types';

export const A = 'a-user';
export const B = 'b-user';
export const C = 'c-user';
export const D = 'd-user';

const tx = (
  id: string,
  type: LedgerTransaction['type'],
  amount: number,
  payers: [string, number][],
  shares: [string, number][],
): LedgerTransaction => ({
  id,
  type,
  currency: 'INR',
  amount,
  payers: payers.map(([userId, a]) => ({ userId, amount: a })),
  shares: shares.map(([userId, a]) => ({ userId, amount: a })),
});

/** 1. A pays the ₹4,000 hotel, split equally among all four. */
export const hotel = tx(
  't1-hotel',
  'expense',
  400_000,
  [[A, 400_000]],
  [
    [A, 100_000],
    [B, 100_000],
    [C, 100_000],
    [D, 100_000],
  ],
);

/** 2. B pays ₹1,200 for dinner, split among A, B and C. */
export const dinner = tx(
  't2-dinner',
  'expense',
  120_000,
  [[B, 120_000]],
  [
    [A, 40_000],
    [B, 40_000],
    [C, 40_000],
  ],
);

/** 3. Fuel ₹3,000: C paid ₹2,000 and D paid ₹1,000, split equally among all four. */
export const fuel = tx(
  't3-fuel',
  'expense',
  300_000,
  [
    [C, 200_000],
    [D, 100_000],
  ],
  [
    [A, 75_000],
    [B, 75_000],
    [C, 75_000],
    [D, 75_000],
  ],
);

/** 4. B settles ₹950 with A. */
export const settlement = tx('t4-settle', 'settlement', 95_000, [[B, 95_000]], [[A, 95_000]]);

/** 5. Dinner corrected from ₹1,200 to ₹1,500 after the settlement. */
export const dinnerCorrected = tx(
  't2-dinner',
  'expense',
  150_000,
  [[B, 150_000]],
  [
    [A, 50_000],
    [B, 50_000],
    [C, 50_000],
  ],
);
