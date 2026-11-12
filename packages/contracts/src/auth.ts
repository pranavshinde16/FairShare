import { z } from 'zod';

/**
 * GET /api/v1/sign-in-options: which sign-in methods the server has configured, so the sign-in
 * screen offers only those. Public. Email codes are always available.
 */
export const SignInOptions = z.object({ google: z.boolean() });
export type SignInOptions = z.infer<typeof SignInOptions>;
