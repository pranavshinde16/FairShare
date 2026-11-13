// Public API of @fairshare/core. Everything else is internal.

export type { Line, Minor, UserId } from './types';
export { DomainError, InvariantViolation, type DomainErrorCode } from './errors';

// money
export { BASIS_POINTS_TOTAL, MAX_AMOUNT_MINOR } from './money/constants';
export { assertValidAmount, isValidAmount } from './money/amount';
export { toDecimalString } from './money/decimal';
export { parseMoney, parsePercent, tryParseMoney } from './money/parse';
export { formatMoney, type FormatMoneyOptions, type IntlLike } from './money/format';

// split
export { allocateProportional, type Weight } from './split/allocate';
export {
  computeShares,
  MAX_SHARES_PER_PERSON,
  type SplitInput,
  type SplitMethod,
} from './split/computeShares';
export { splitPaymentEqually, validatePayers } from './split/payers';

// ledger and balances
export type {
  CurrencyNets,
  LedgerTransaction,
  PaymentMethod,
  TransactionType,
} from './ledger/types';
export {
  ledgerLines,
  netsFromTransactions,
  settlementLines,
  type SettlementInput,
} from './ledger/ledger';
export { simplify, type Transfer } from './simplify/simplify';

// invariants
export { invariant } from './invariants/invariant';
export { assertNetsSumToZero, assertTransactionInvariants } from './invariants/transaction';

// activity
export {
  canonicalSnapshot,
  diffSnapshots,
  type FieldChange,
  type LinesChange,
  type ScalarField,
  type TransactionSnapshot,
} from './activity/diff';

// natural-language entry (Blueprint 8.2, 8.6)
export { parseRules, type Doubt, type RuleParse, type RuleParseInput } from './parse/rules';
export {
  isSelf,
  normalizeName,
  resolveName,
  SELF_WORDS,
  withinOneEdit,
  type NameCandidate,
  type Resolution,
} from './resolve/resolve';
export { chooseGroup, type GroupCandidate } from './resolve/groups';
