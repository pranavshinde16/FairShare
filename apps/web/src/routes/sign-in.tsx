import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { Logo } from '../components/common/logo';
import { safeReturnTo } from '../features/auth/return-to';
import { sessionQuery } from '../features/auth/session';

const SignInSearch = z.object({
  /** Where to go after signing in. Checked by safeReturnTo before use. */
  returnTo: z.string().optional().catch(undefined),
  /** Set by Better Auth when a Google sign-in fails. */
  error: z.string().optional().catch(undefined),
  /** Set after the account was deleted, to say so. */
  deleted: z.boolean().optional().catch(undefined),
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
      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>FairShare keeps track of shared expenses, so friends can settle up fairly.</p>
        <p>
          By continuing you agree to the{' '}
          <Link to="/terms" className="underline underline-offset-4 hover:text-foreground">
            terms of use
          </Link>
          . See the{' '}
          <Link to="/privacy" className="underline underline-offset-4 hover:text-foreground">
            privacy notice
          </Link>{' '}
          for how your data is handled.
        </p>
      </div>
    </main>
  );
}
