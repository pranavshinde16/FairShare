import { z } from 'zod';
import { Amount, CurrencyCode, Money, NetLine, Uuid } from './primitives';

/** A suggested payment: `from` pays `to`. */
export const Transfer = z.object({ from: Uuid, to: Uuid, amount: Amount });
export type Transfer = z.infer<typeof Transfer>;

/** One currency's balances in a group: each member's net (paid − share) and how to settle up. */
export const Balances = z.object({
  currency: CurrencyCode,
  nets: z.array(NetLine),
  transfers: z.array(Transfer),
});
export type Balances = z.infer<typeof Balances>;

/** A transfer outside its Balances entry has to carry its currency. */
export const CurrencyTransfer = Transfer.extend({ currency: CurrencyCode });

/** GET /groups/:groupId/balances. */
export const GroupBalances = z.object({
  balances: z.array(Balances),
  /** The caller's view: net per currency and the suggested transfers involving them. */
  me: z.object({
    net: z.array(Money),
    owes: z.array(CurrencyTransfer),
    owed: z.array(CurrencyTransfer),
  }),
  /**
   * Each member's net, explained, per currency: what they paid for expenses and their share of
   * them, then the settlement money they sent and received. net = paid − share + sent − received.
   */
  breakdown: z.array(
    z.object({ userId: Uuid, paid: Money, share: Money, sent: Money, received: Money }),
  ),
});
export type GroupBalances = z.infer<typeof GroupBalances>;
