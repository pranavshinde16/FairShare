import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { Logo } from '../components/common/logo';
import { safeReturnTo } from '../features/auth/return-to';
import { sessionQuery } from '../features/auth/session';

const SignInSearch = z.object({
  /** Where to go after signing in. Checked by safeReturnTo before use. */
  returnTo: z.string().optional().catch(undefined),
  /** Set by Better Auth when a Google sign-in fails. */
  error: z.string().optional().catch(undefined),
});

/** The layout shared by both sign-in steps. Signed-in visitors go straight on. */
export const Route = createFileRoute('/sign-in')({
  validateSearch: SignInSearch,
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session) throw redirect({ href: safeReturnTo(search.returnTo), replace: true });
  },
  component: SignInLayout,
});

function SignInLayout() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <Logo className="text-lg" />
      <Outlet />
      <p className="text-xs text-muted-foreground">
        FairShare keeps track of shared expenses, so friends can settle up fairly.
      </p>
    </main>
  );
}
