// Used only by `pnpm generate:auth`, which writes Better Auth's tables to src/schema/auth.ts.
// The real auth instance (apps/api, Phase 5) must use the same model names, field mappings and
// plugins, or the generated tables won't match what Better Auth expects.

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/node-postgres';

export const auth = betterAuth({
  database: drizzleAdapter(drizzle.mock(), { provider: 'pg' }),
  user: { modelName: 'auth_user' },
  session: { modelName: 'auth_session' },
  account: { modelName: 'auth_account' },
  verification: { modelName: 'auth_verification' },
  plugins: [emailOTP({ sendVerificationOTP: () => Promise.resolve() })],
});
