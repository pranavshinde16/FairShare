import { z } from 'zod';
import { Timestamp, Uuid } from './primitives';

/** The raw invite token: 32 random bytes in base64url. Only its SHA-256 hash is stored. */
export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid invite token');

/** POST /groups/:groupId/invites. A targeted invite preselects that placeholder on the claim screen. */
export const CreateInvite = z.strictObject({ targetPlaceholderId: Uuid.optional() });
export type CreateInvite = z.infer<typeof CreateInvite>;

export const InviteCreated = z.object({ id: Uuid, url: z.url(), expiresAt: Timestamp });
export type InviteCreated = z.infer<typeof InviteCreated>;

/** GET /invites/:token (public). Shows just enough to decide whether to join. */
export const InvitePreview = z.object({
  group: z.object({
    name: z.string().nullable(), // null for a direct group
    emoji: z.string().nullable(),
    memberCount: z.int().min(1),
  }),
  invitedBy: z.object({ name: z.string() }),
  placeholders: z.array(z.object({ id: Uuid, name: z.string() })),
  targetPlaceholderId: Uuid.nullable(),
  expired: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

/** POST /invites/:token/accept. Without claimPlaceholderId the user joins as a new member. */
export const AcceptInvite = z.strictObject({ claimPlaceholderId: Uuid.optional() });
export type AcceptInvite = z.infer<typeof AcceptInvite>;

export const AcceptInviteResponse = z.object({ groupId: Uuid });
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponse>;
