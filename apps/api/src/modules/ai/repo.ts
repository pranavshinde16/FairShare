// Queries for typed entry: the ai_requests log (limits, budget, the 30-day purge) and the groups a
// sentence can belong to. Reads groups through the groups repository; never touches transactions
// (Blueprint 8.1, enforced by architecture.test.ts).

import type { UserRef } from '@fairshare/contracts';
import type { NameCandidate } from '@fairshare/core';
import { activityLog, aiRequests, currencies, type Db } from '@fairshare/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import * as groupsRepo from '../groups/repo';
import { toUserRef } from '../groups/service';

export type NewAiRequest = typeof aiRequests.$inferInsert;

/** Records one provider call; returns its ID (the draft's requestId). */
export async function insertRequest(db: Db, row: NewAiRequest): Promise<number> {
  const [inserted] = await db.insert(aiRequests).values(row).returning({ id: aiRequests.id });
  return inserted!.id;
}

/** Provider calls made for this person since `since`. */
export async function callsSince(db: Db, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(aiRequests)
    .where(and(eq(aiRequests.userId, userId), gte(aiRequests.createdAt, since)));
  return Number(row!.count);
}

/** Tokens and cost spent since `since`, per provider. */
export async function usageSince(
  db: Db,
  since: Date,
): Promise<Map<string, { tokens: number; costMicros: number }>> {
  const rows = await db
    .select({
      provider: aiRequests.provider,
      tokens: sql<string>`coalesce(sum(coalesce(${aiRequests.inputTokens}, 0) + coalesce(${aiRequests.outputTokens}, 0)), 0)`,
      costMicros: sql<string>`coalesce(sum(${aiRequests.costMicros}), 0)`,
    })
    .from(aiRequests)
    .where(gte(aiRequests.createdAt, since))
    .groupBy(aiRequests.provider);
  return new Map(
    rows.map((r) => [
      r.provider ?? '',
      { tokens: Number(r.tokens), costMicros: Number(r.costMicros) },
    ]),
  );
}

/** A group a typed expense could belong to, as typed entry needs it. */
export type EntryGroup = {
  id: string;
  kind: 'group' | 'direct';
  currency: string;
  minorUnits: number;
  /** Members who can take part (not left, account not deleted), the person typing included. */
  candidates: NameCandidate[];
  /** Everyone who can take part, as shown to the person (for "Which Rahul?"). */
  people: Map<string, UserRef>;
  /** ISO timestamp of its latest activity, or "" when there's none. */
  lastActivityAt: string;
};

/** The groups I'm an active member of, both kinds; or just `groupId`, if I'm in it. */
export async function entryGroups(db: Db, me: string, groupId?: string): Promise<EntryGroup[]> {
  let rows: groupsRepo.GroupRow[];
  if (groupId === undefined) {
    rows = await groupsRepo.listMyGroups(db, me);
  } else {
    const membership = await groupsRepo.findActiveMembership(db, groupId, me);
    rows = membership ? [membership.group] : [];
  }
  if (rows.length === 0) return [];
  const ids = rows.map((g) => g.id);
  const [members, units, latest] = await Promise.all([
    groupsRepo.listMembersOf(db, ids),
    db.select({ code: currencies.code, minorUnits: currencies.minorUnits }).from(currencies),
    db
      .select({
        groupId: activityLog.groupId,
        at: sql<string>`to_char(max(${activityLog.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(activityLog)
      .where(inArray(activityLog.groupId, ids))
      .groupBy(activityLog.groupId),
  ]);
  const minorUnits = new Map(units.map((u) => [u.code, u.minorUnits]));
  const lastActivity = new Map(latest.map((l) => [l.groupId, l.at]));
  return rows.map((group) => {
    const active = members.filter(
      (m) => m.groupId === group.id && m.leftAt === null && !m.isDeleted,
    );
    return {
      id: group.id,
      kind: group.kind,
      currency: group.currency,
      minorUnits: minorUnits.get(group.currency) ?? 2,
      candidates: active.map((m) => ({ userId: m.userId, name: m.name })),
      people: new Map(active.map((m) => [m.userId, toUserRef(m)])),
      lastActivityAt: lastActivity.get(group.id) ?? '',
    };
  });
}
