import type { AuthUserInfo, UsersService } from '../users/service';

export type DomainUserResolver = {
  /** The domain user ID for a signed-in auth user, creating the domain user if needed. */
  idFor: (authUser: AuthUserInfo, acceptLanguage?: string | null) => Promise<string>;
};

/**
 * Remembers which domain user belongs to each auth user. The link never changes while the auth
 * user exists, so after the first request each one costs no query here. Bounded: the oldest
 * entries go first once `max` are held.
 */
export function createDomainUserResolver(users: UsersService, max = 10_000): DomainUserResolver {
  const ids = new Map<string, string>();
  return {
    async idFor(authUser, acceptLanguage) {
      const cached = ids.get(authUser.id);
      if (cached) return cached;
      const id = await users.ensureDomainUser(authUser, acceptLanguage);
      if (ids.size >= max) ids.delete(ids.keys().next().value!);
      ids.set(authUser.id, id);
      return id;
    },
  };
}
