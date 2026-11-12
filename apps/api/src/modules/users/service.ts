import type { Profile, UpdateProfile } from '@fairshare/contracts';
import { withTx, type Db } from '@fairshare/db';
import { AppError } from '../../http/errors';
import { uuidv7 } from '../../lib/ids';
import * as currencies from '../currencies/repo';
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
     * Account deletion's first step (DELETE /me arrives in Phase 13): anonymize the domain user and
     * delete the auth user, its sessions and linked accounts, in one transaction. Phase 13 adds
     * leaving settled direct groups and the activity entries.
     */
    async anonymizeUser(userId: string): Promise<void> {
      await withTx(db, async (tx) => {
        const authUserId = await repo.anonymizeUser(tx, userId);
        if (authUserId) await repo.deleteAuthUser(tx, authUserId);
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
