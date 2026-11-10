/**
 * Codes for invalid input that a user can fix. The API maps each one to an HTTP status and the UI
 * maps each one to friendly copy, so codes are a stable contract: rename with care.
 */
export type DomainErrorCode =
  | 'INVALID_MONEY'
  | 'INVALID_PERCENT'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_USER'
  | 'INVALID_WEIGHT'
  | 'SPLIT_SUM_MISMATCH'
  | 'PAYER_SUM_MISMATCH'
  | 'PERCENT_SUM_INVALID'
  | 'SETTLEMENT_SAME_USER';

/** Invalid input: the caller (ultimately the user) sent something that can't be accepted. */
export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

/**
 * A broken internal guarantee, such as nets that don't sum to zero. This always means a bug, never
 * bad input, so it should be logged and alerted on rather than shown to the user.
 */
export class InvariantViolation extends Error {
  override readonly name = 'InvariantViolation';

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
