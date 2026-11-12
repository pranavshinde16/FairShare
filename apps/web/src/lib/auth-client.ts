import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';

/**
 * Better Auth's browser client for /api/auth/*: email codes, Google, sessions, sign-out. Same
 * origin in every environment, like the API client.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [emailOTPClient()],
});
