import type { Profile, UpdateProfile } from '@fairshare/contracts';
import { withTx, type Db } from '@fairshare/db';
import { AppError } from '../../http/errors';
import { uuidv7 } from '../../lib/ids';
import * as currencies from '../currencies/repo';
import { withdrawDeletedUser } from '../groups/service';
import { currencyFromAcceptLanguage, initialName } from './defaults';
import * as repo from './repo';

/** The parts of a Better Auth user this module reads. */
export type AuthUserInfo = { id: string; name: string; email: string; image?: string | null };

export type UsersService = ReturnType<typeof createUsersService>;

export function createUsersService(db: Db) {
  return {
    async getProfile(userId: string): Promise<Profile> {
      const row = await repo.findProfile(db, userId);
      if (!row) throw signedOut();
      return toProfile(row);
    },

    async updateProfile(userId: string, changes: UpdateProfile): Promise<Profile> {
      // Nothing to change (an empty body) is the profile as it is.
      if (Object.keys(changes).length === 0) return this.getProfile(userId);
      if (changes.defaultCurrency && !(await currencies.exists(db, changes.defaultCurrency))) {
        throw new AppError('VALIDATION_FAILED', 'The request is invalid.', {
          issues: [{ path: ['defaultCurrency'], message: 'Unsupported currency', code: 'custom' }],
        });
      }
      const row = await repo.updateProfile(db, userId, changes);
      if (!row) throw signedOut();
      return toProfile(row);
    },

    /**
     * The domain user for an auth user, created on first sign-in. Called by the sign-up hook and,
     * because that hook runs after Better Auth's own transaction and may fail on its own, by the
     * auth middleware too. Safe to call any number of times.
     */
    async ensureDomainUser(
      authUser: AuthUserInfo,
      acceptLanguage?: string | null,
    ): Promise<string> {
      const existing = await repo.findUserIdByAuthUserId(db, authUser.id);
      if (existing) return existing;
      return repo.insertUserForAuthUser(db, {
        id: uuidv7(),
        authUserId: authUser.id,
        name: initialName(authUser.name, authUser.email),
        email: authUser.email,
        avatarUrl: avatarUrl(authUser.image),
        defaultCurrency: currencyFromAcceptLanguage(acceptLanguage),
      });
    },

    /**
     * DELETE /me (Blueprint 4.1), in one transaction:
     *
     * - groups: leave where settled, stay as "Deleted user" where still owing or owed, hand on
     *   ownership, and a member.deleted entry in each (withdrawDeletedUser);
     * - the person: name "Deleted user", email, picture and UPI ID cleared, deleted_at set;
     * - sign-in: the auth user, its sessions and linked accounts, and any pending sign-in code.
     *
     * Expenses stay, because other people's balances depend on them. Safe to run twice.
     */
    async deleteAccount(userId: string): Promise<void> {
      await withTx(db, async (tx) => {
        const person = await repo.lockUser(tx, userId);
        if (!person) return;
        if (!person.deletedAt) await withdrawDeletedUser(tx, userId);
        await repo.anonymizeUser(tx, userId);
        if (person.authUserId) await repo.deleteAuthUser(tx, person.authUserId);
        if (person.email) await repo.deletePendingCodes(tx, person.email);
      });
    },
  };
}

function toProfile(row: repo.ProfileRow): Profile {
  // Real users always have their auth email; only placeholders and deleted users lack one, and
  // neither can have a session.
  if (row.email === null) throw new Error(`User ${row.id} has a session but no email`);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    defaultCurrency: row.defaultCurrency,
    upiVpa: row.upiVpa,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A session whose user is gone (deleted meanwhile) is treated as signed out. */
const signedOut = () => new AppError('UNAUTHENTICATED', 'Sign in to continue.');

/** Google's profile picture. Only an https URL is kept; anything else shows initials instead. */
function avatarUrl(image: string | null | undefined): string | null {
  if (!image || image.length > 2048) return null;
  try {
    return new URL(image).protocol === 'https:' ? image : null;
  } catch {
    return null;
  }
}
