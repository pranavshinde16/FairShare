import { InvariantViolation } from '../errors';

/** Throws InvariantViolation when a guarantee the code relies on doesn't hold. */
export function invariant(
  condition: boolean,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (!condition) throw new InvariantViolation(message, details);
}
