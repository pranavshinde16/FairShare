import { z } from 'zod';
import { GroupKind } from './groups';
import { Uuid } from './primitives';

/**
 * A placeholder someone added with my email address as its hint, which I may claim: claiming
 * merges it into my account, exactly as claiming through an invite link does.
 */
export const Claimable = z.object({
  placeholder: z.object({ id: Uuid, name: z.string() }),
  addedBy: z.object({ name: z.string() }),
  groups: z.array(
    z.object({
      id: Uuid,
      kind: GroupKind,
      name: z.string().nullable(), // null for a direct group
      emoji: z.string().nullable(),
    }),
  ),
});
export type Claimable = z.infer<typeof Claimable>;

/** GET /claims. */
export const ClaimList = z.object({ items: z.array(Claimable) });
export type ClaimList = z.infer<typeof ClaimList>;

/** POST /claims/:placeholderId: the groups I'm now a member of. */
export const ClaimResponse = z.object({ groupIds: z.array(Uuid) });
export type ClaimResponse = z.infer<typeof ClaimResponse>;
