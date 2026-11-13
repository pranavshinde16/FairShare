// The nightly invariant check (Blueprint 9.2): the database is read for anything that should be
// impossible. In a correct system every list here is always empty; a finding means a bug got past
// core, the service and the commit-time triggers, and is the "smoke alarm" the plan asks for.

import { sql } from 'drizzle-orm';
import type { Db } from './client';

export type InvariantReport = {
  /** I1–I3: a transaction whose payers or shares don't add up to its amount. */
  transactionSums: { transactionId: string; amount: number; paid: number; shared: number }[];
  /** I6: a group whose balances don't sum to zero in some currency. */
  groupNets: { groupId: string; currency: string; total: number }[];
  /** I8: a live transaction, last written after someone in it had left the group (or never joined). */
  inactiveMembers: { transactionId: string; userId: string }[];
};

/** At most this many examples of each kind, so one systematic bug can't flood the report. */
const LIMIT = 100;

/** Runs every check in one read-only transaction, so they all see the same moment. */
export async function checkInvariants(db: Db): Promise<InvariantReport> {
  return db.transaction(
    async (tx) => {
      const sums = await tx.execute<{
        transaction_id: string;
        amount: string;
        paid: string;
        shared: string;
      }>(sql`
        SELECT t.id AS transaction_id, t.amount,
               coalesce(p.total, 0) AS paid, coalesce(s.total, 0) AS shared
        FROM transactions t
        LEFT JOIN (SELECT transaction_id, sum(amount) AS total
                   FROM transaction_payers GROUP BY transaction_id) p ON p.transaction_id = t.id
        LEFT JOIN (SELECT transaction_id, sum(amount) AS total
                   FROM transaction_shares GROUP BY transaction_id) s ON s.transaction_id = t.id
        -- Deleted ones too: a restore would bring them back as they are.
        WHERE t.amount <> coalesce(p.total, 0) OR t.amount <> coalesce(s.total, 0)
        ORDER BY t.id
        LIMIT ${LIMIT}`);

      const nets = await tx.execute<{ group_id: string; currency: string; total: string }>(sql`
        SELECT group_id, currency, sum(amount) AS total
        FROM ledger
        GROUP BY group_id, currency
        HAVING sum(amount) <> 0
        ORDER BY group_id, currency
        LIMIT ${LIMIT}`);

      // Leaving needs a zero balance, so old transactions keep naming people who left; that's
      // fine. Wrong is one written (created, edited or restored) after they left: the service
      // refuses that with MEMBER_INACTIVE (I8).
      const inactive = await tx.execute<{ transaction_id: string; user_id: string }>(sql`
        SELECT DISTINCT t.id AS transaction_id, l.user_id
        FROM transactions t
        JOIN (SELECT transaction_id, user_id FROM transaction_payers
              UNION SELECT transaction_id, user_id FROM transaction_shares) l
          ON l.transaction_id = t.id
        LEFT JOIN group_members m ON m.group_id = t.group_id AND m.user_id = l.user_id
        WHERE t.deleted_at IS NULL
          AND (m.user_id IS NULL
               OR (m.left_at IS NOT NULL AND m.left_at < coalesce(t.updated_at, t.created_at)))
        ORDER BY t.id, l.user_id
        LIMIT ${LIMIT}`);

      return {
        transactionSums: sums.rows.map((r) => ({
          transactionId: r.transaction_id,
          amount: Number(r.amount),
          paid: Number(r.paid),
          shared: Number(r.shared),
        })),
        groupNets: nets.rows.map((r) => ({
          groupId: r.group_id,
          currency: r.currency,
          total: Number(r.total),
        })),
        inactiveMembers: inactive.rows.map((r) => ({
          transactionId: r.transaction_id,
          userId: r.user_id,
        })),
      };
    },
    { accessMode: 'read only', isolationLevel: 'repeatable read' },
  );
}

/** How many findings of each kind: what the nightly job prints, since its logs are public. */
export function summarize(report: InvariantReport) {
  return {
    transactionSums: report.transactionSums.length,
    groupNets: report.groupNets.length,
    inactiveMembers: report.inactiveMembers.length,
  };
}

export const isClean = (report: InvariantReport) =>
  Object.values(summarize(report)).every((count) => count === 0);
