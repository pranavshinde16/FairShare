import type { ActivityVerb, EntityType } from '@fairshare/contracts';
import { activityLog, type Tx } from '@fairshare/db';

export type ActivityRecord = {
  groupId: string;
  actorId: string;
  verb: ActivityVerb;
  entityType: EntityType;
  entityId: string;
  /** The person the action is about (added, removed, claimed), if any. */
  targetUser?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

/**
 * Appends entries to the activity log. Always called with the transaction that makes the change,
 * so the change and its history commit together or not at all (I11). The log is append-only.
 */
export async function recordActivity(tx: Tx, ...entries: ActivityRecord[]): Promise<void> {
  if (entries.length === 0) return;
  await tx.insert(activityLog).values(
    entries.map((e) => ({
      groupId: e.groupId,
      actorId: e.actorId,
      verb: e.verb,
      entityType: e.entityType,
      entityId: e.entityId,
      targetUser: e.targetUser ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
    })),
  );
}
