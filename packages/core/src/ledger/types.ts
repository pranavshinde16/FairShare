import type { Line, Minor } from '../types';

export type TransactionType = 'expense' | 'settlement';

/** How a settlement was paid. */
export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'other';

/** The money facts of one transaction: what each person paid and what each person consumed. */
export type LedgerTransaction = {
  id: string;
  type: TransactionType;
  currency: string;
  amount: Minor;
  payers: Line[];
  shares: Line[];
};

/** Net balances for one currency. Positive: the person is owed. Negative: the person owes. */
export type CurrencyNets = { currency: string; nets: Line[] };
