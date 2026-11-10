import { DomainError } from '../errors';
import type { Minor } from '../types';
import { MAX_AMOUNT_MINOR } from './constants';

/** A transaction amount: a whole number of minor units from 1 up to the cap. */
export function isValidAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_AMOUNT_MINOR;
}

export function assertValidAmount(value: Minor, field = 'amount'): void {
  if (!isValidAmount(value)) {
    throw new DomainError(
      'AMOUNT_OUT_OF_RANGE',
      `${field} must be a whole number of minor units between 1 and ${MAX_AMOUNT_MINOR}.`,
      { field, min: 1, max: MAX_AMOUNT_MINOR, actual: value },
    );
  }
}
