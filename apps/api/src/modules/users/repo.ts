// Drizzle queries for users. Every function takes the handle to run on: the pool, or a
// transaction from withTx.

import { auth_user, users, type Db, type Tx } from '@fairshare/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

type Handle = Db | Tx;

const profileColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  avatarUrl: users.avatarUrl,
  defaultCurrency: users.defaultCurrency,
  upiVpa: users.upiVpa,
  createdAt: users.createdAt,
};

export type ProfileRow = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  defaultCurrency: string;
  upiVpa: string | null;
  createdAt: Date;
};

export async function findProfile(db: Handle, userId: string): Promise<ProfileRow | undefined> {
  const [row] = await db
    .select(profileColumns)
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return row;
}

export type ProfileChanges = { name?: string; defaultCurrency?: string; upiVpa?: string | null };

export async function updateProfile(
  db: Handle,
  userId: string,
  changes: ProfileChanges,
): Promise<ProfileRow | undefined> {
  const [row] = await db
    .update(users)
    .set(changes)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning(profileColumns);
  return row;
}

export async function findUserIdByAuthUserId(
  db: Handle,
  authUserId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.authUserId, authUserId));
  return row?.id;
}

export type NewRealUser = {
  id: string;
  authUserId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  defaultCurrency: string;
};

/**
 * Inserts the domain user for an auth user unless one exists already (two requests racing, or
 * the sign-up hook and the auth middleware both trying). Returns the ID that's stored.
 */
export async function insertUserForAuthUser(db: Handle, user: NewRealUser): Promise<string> {
  await db.insert(users).values(user).onConflictDoNothing({ target: users.authUserId });
  const id = await findUserIdByAuthUserId(db, user.authUserId);
  if (!id) throw new Error(`No domain user for auth user ${user.authUserId} after insert`);
  return id;
}

/**
 * Clears what identifies a person and marks them deleted. The row stays: other people's
 * transactions point at it, and it shows as "Deleted user". Returns the auth user it was linked
 * to, if any.
 */
export async function anonymizeUser(tx: Tx, userId: string): Promise<string | null | undefined> {
  const [before] = await tx
    .select({ authUserId: users.authUserId })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!before) return undefined;
  await tx
    .update(users)
    .set({
      name: 'Deleted user',
      email: null,
      avatarUrl: null,
      upiVpa: null,
      authUserId: null,
      deletedAt: sql`coalesce(${users.deletedAt}, now())`,
    })
    .where(eq(users.id, userId));
  return before.authUserId;
}

/** Deletes an auth user. Its sessions and linked accounts go with it (ON DELETE CASCADE). */
export async function deleteAuthUser(tx: Tx, authUserId: string): Promise<void> {
  await tx.delete(auth_user).where(eq(auth_user.id, authUserId));
}
