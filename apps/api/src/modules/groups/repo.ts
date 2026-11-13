// Drizzle queries for groups, members and placeholders. Every function takes the handle to run
// on: the pool, or a transaction from withTx. Queries that read group data take the group ID.

import { groupMembers, groups, transactions, users, type Db, type Tx } from '@fairshare/db';
import { aliasedTable, and, asc, eq, exists, inArray, isNull, ne, sql } from 'drizzle-orm';
import { isDeletedColumn } from '../users/repo';

type Handle = Db | Tx;

export type GroupRow = typeof groups.$inferSelect;
export type Role = 'owner' | 'member';

/** A membership row with the person's public details. */
export type MemberRow = {
  userId: string;
  role: Role;
  joinedAt: Date;
  leftAt: Date | null;
  name: string;
  avatarUrl: string | null;
  isPlaceholder: boolean;
  isDeleted: boolean;
  mergedInto: string | null;
};

const memberColumns = {
  userId: groupMembers.userId,
  role: groupMembers.role,
  joinedAt: groupMembers.joinedAt,
  leftAt: groupMembers.leftAt,
  name: users.name,
  avatarUrl: users.avatarUrl,
  isPlaceholder: users.isPlaceholder,
  isDeleted: isDeletedColumn,
  mergedInto: users.mergedInto,
};

export async function findGroup(db: Handle, groupId: string): Promise<GroupRow | undefined> {
  const [row] = await db.select().from(groups).where(eq(groups.id, groupId));
  return row;
}

/**
 * Locks the group row until the transaction ends, so its state can't change under a check.
 * NO KEY UPDATE, not UPDATE: writers still queue behind each other, but rows that merely reference
 * the group (activity entries, memberships) can still be inserted by others. A plain UPDATE lock
 * blocks those foreign-key checks, which deadlocked two claims of one placeholder from two groups.
 */
export async function lockGroup(tx: Tx, groupId: string): Promise<GroupRow | undefined> {
  const [row] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('no key update');
  return row;
}

/** The caller's active membership in a group that isn't deleted: the authorization primitive. */
export async function findActiveMembership(
  db: Handle,
  groupId: string,
  userId: string,
): Promise<{ group: GroupRow; role: Role } | undefined> {
  const [row] = await db
    .select({ group: groups, role: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
        isNull(groups.deletedAt),
      ),
    );
  return row;
}

/** Every member of a group, those who left included, oldest first. */
export async function listMembers(db: Handle, groupId: string): Promise<MemberRow[]> {
  return db
    .select(memberColumns)
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.userId));
}

/** Members of several groups at once, for lists. */
export async function listMembersOf(db: Handle, groupIds: string[]) {
  if (groupIds.length === 0) return [];
  return db
    .select({ groupId: groupMembers.groupId, ...memberColumns })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(inArray(groupMembers.groupId, groupIds))
    .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.userId));
}

/** The groups (of one kind, or both) I'm an active member of, newest first. */
export async function listMyGroups(
  db: Handle,
  userId: string,
  kind?: 'group' | 'direct',
): Promise<(GroupRow & { myRole: Role })[]> {
  const rows = await db
    .select({ group: groups, myRole: groupMembers.role })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt),
        isNull(groups.deletedAt),
        kind ? eq(groups.kind, kind) : undefined,
      ),
    )
    .orderBy(sql`${groups.createdAt} DESC`, sql`${groups.id} DESC`);
  return rows.map(({ group, myRole }) => ({ ...group, myRole }));
}

export async function findMembership(db: Handle, groupId: string, userId: string) {
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  return row;
}

export async function insertMembers(
  tx: Tx,
  groupId: string,
  members: { userId: string; role: Role }[],
): Promise<void> {
  if (members.length === 0) return;
  await tx.insert(groupMembers).values(members.map((m) => ({ groupId, ...m })));
}

/** Brings back someone who left: active again, and their seniority starts now. */
export async function rejoin(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx
    .update(groupMembers)
    .set({ leftAt: null, role: 'member', joinedAt: sql`now()` })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

export async function markLeft(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx
    .update(groupMembers)
    .set({ leftAt: sql`now()`, role: 'member' })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

/** An owner who stays (a deleted account still owing) but can't own the group any more. */
export async function demote(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx
    .update(groupMembers)
    .set({ role: 'member' })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

export async function makeOwner(tx: Tx, groupId: string, userId: string): Promise<void> {
  await tx
    .update(groupMembers)
    .set({ role: 'owner' })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

export type NewPlaceholder = { id: string; name: string; email: string | null; createdBy: string };

export async function insertPlaceholder(tx: Tx, placeholder: NewPlaceholder): Promise<void> {
  await tx.insert(users).values({ ...placeholder, isPlaceholder: true });
}

/** A person who can be added to a group: not deleted, and not a placeholder already claimed. */
export async function findAddableUser(db: Handle, userId: string) {
  const [row] = await db
    .select({ id: users.id, name: users.name, isPlaceholder: users.isPlaceholder })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt), isNull(users.mergedInto)));
  return row;
}

/** True when both are active members of some group that isn't deleted. */
export async function shareAGroup(db: Handle, me: string, other: string): Promise<boolean> {
  const mine = aliasedTable(groupMembers, 'mine');
  const theirs = aliasedTable(groupMembers, 'theirs');
  const [row] = await db
    .select({ groupId: mine.groupId })
    .from(mine)
    .innerJoin(theirs, eq(theirs.groupId, mine.groupId))
    .innerJoin(groups, eq(groups.id, mine.groupId))
    .where(
      and(
        eq(mine.userId, me),
        isNull(mine.leftAt),
        eq(theirs.userId, other),
        isNull(theirs.leftAt),
        isNull(groups.deletedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Everyone I share an active group with, except me and deleted accounts (they can't be added). */
export async function listPeopleISeeIn(db: Handle, me: string) {
  const mine = aliasedTable(groupMembers, 'mine');
  return db
    .selectDistinct({
      id: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
      isPlaceholder: users.isPlaceholder,
      isDeleted: isDeletedColumn,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        ne(groupMembers.userId, me),
        isNull(groupMembers.leftAt),
        isNull(users.deletedAt),
        isNull(groups.deletedAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(mine)
            .where(
              and(eq(mine.groupId, groupMembers.groupId), eq(mine.userId, me), isNull(mine.leftAt)),
            ),
        ),
      ),
    );
}

/** Any transaction at all, deleted ones included: they could be restored in the old currency. */
export async function hasTransactions(db: Handle, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.groupId, groupId))
    .limit(1);
  return row !== undefined;
}
