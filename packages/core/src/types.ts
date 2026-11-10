/** An amount in a currency's minor units (paise for INR). Always a safe integer, never fractional. */
export type Minor = number;

export type UserId = string;

/** One person's amount within a transaction: what they paid, or their share. */
export type Line = { userId: UserId; amount: Minor };
