import { z } from 'zod';
import { Friend } from './friends';
import { Group } from './groups';
import { CurrencyCode, Money, Timestamp } from './primitives';

/** GET /home. Lists put non-zero balances first. */
export const Home = z.object({
  /** Per currency: the total others owe me and the total I owe, both ≥ 0. */
  totals: z.array(z.object({ currency: CurrencyCode, owed: z.int().min(0), owe: z.int().min(0) })),
  groups: z.array(z.object({ group: Group, myNet: z.array(Money), lastActivityAt: Timestamp })),
  people: z.array(Friend),
});
export type Home = z.infer<typeof Home>;
