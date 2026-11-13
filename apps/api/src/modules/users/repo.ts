// Drizzle queries for users. Every function takes the handle to run on: the pool, or a
// transaction from withTx.

import { auth_user, auth_verification, users, type Db, type Tx } from '@fairshare/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

type Handle = Db | Tx;

/** Whether the account was deleted (Blueprint 4.1), for UserRef.isDeleted. */
export const isDeletedColumn = sql<boolean>`(${users.deletedAt} IS NOT NULL)`.mapWith(Boolean);

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

/** Locks a person's row for the rest of the transaction, returning what deletion needs. */
export async function lockUser(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ authUserId: users.authUserId, email: users.email, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  return row;
}

/**
 * Clears what identifies a person and marks them deleted. The row stays: other people's
 * transactions point at it, and it shows as "Deleted user".
 */
export async function anonymizeUser(tx: Tx, userId: string): Promise<void> {
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
}

/** Deletes an auth user. Its sessions and linked accounts go with it (ON DELETE CASCADE). */
export async function deleteAuthUser(tx: Tx, authUserId: string): Promise<void> {
  await tx.delete(auth_user).where(eq(auth_user.id, authUserId));
}

/**
 * Sign-in codes not used yet, which Better Auth's email-OTP plugin keys by
 * "<type>-otp-<email>" (the address lower-cased). They'd expire within minutes anyway.
 */
export async function deletePendingCodes(tx: Tx, email: string): Promise<void> {
  const address = email.toLowerCase();
  const identifiers = ['sign-in', 'email-verification', 'forget-password', 'change-email'].map(
    (type) => `${type}-otp-${address}`,
  );
  await tx.delete(auth_verification).where(inArray(auth_verification.identifier, identifiers));
}
