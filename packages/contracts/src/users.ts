import { z } from 'zod';
import { CurrencyCode, PersonName, Timestamp, Uuid } from './primitives';

/** How another person appears anywhere in the app. Placeholders are people without an account. */
export const UserRef = z.object({
  id: Uuid,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  isPlaceholder: z.boolean(),
});
export type UserRef = z.infer<typeof UserRef>;

/** A UPI ID such as "rahul@okaxis". */
export const UPI_VPA_PATTERN = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

/** GET /me and PATCH /me. */
export const Profile = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  defaultCurrency: CurrencyCode,
  upiVpa: z.string().nullable(),
  createdAt: Timestamp,
});
export type Profile = z.infer<typeof Profile>;

/** PATCH /me. Omitted fields are left alone; `upiVpa: null` removes the UPI ID. */
export const UpdateProfile = z.strictObject({
  name: PersonName.optional(),
  defaultCurrency: CurrencyCode.optional(),
  upiVpa: z.string().trim().regex(UPI_VPA_PATTERN, 'Invalid UPI ID').nullable().optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfile>;

/** DELETE /me. The literal makes accidental deletion impossible. */
export const DeleteAccount = z.strictObject({ confirm: z.literal('DELETE') });
export type DeleteAccount = z.infer<typeof DeleteAccount>;
