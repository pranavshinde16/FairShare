/**
 * Largest amount a single transaction may carry, in minor units (₹10 crore for INR).
 *
 * Money moves through the app as safe-integer `number`s. Allocation multiplies an
 * amount by a weight (at most 10,000 basis points), and this cap keeps that product
 * far below Number.MAX_SAFE_INTEGER, so integer arithmetic stays exact.
 */
export const MAX_AMOUNT_MINOR = 10_000_000_000;

/** Percent splits are expressed in basis points: 100% = 10,000. */
export const BASIS_POINTS_TOTAL = 10_000;
