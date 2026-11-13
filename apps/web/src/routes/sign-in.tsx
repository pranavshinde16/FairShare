import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { z } from 'zod';
import { FairShareLogo, FairShareTile } from '../components/brand/fairshare-logo';
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

/**
 * Sign in and its code step (DESIGN_SPEC §5 m-signin, d-signin). Phones: the form in one column,
 * the terms at the foot. Desktop: a primary brand panel with what FairShare does, and the form.
 */
function SignInLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <section
        aria-label="About FairShare"
        className="hidden flex-col justify-between gap-8 bg-primary px-14 py-12 text-primary-foreground lg:flex lg:w-[420px] lg:shrink-0"
      >
        {/* On the teal panel: the app-icon tile and the wordmark in the panel's own text colour. */}
        <span role="img" aria-label="FairShare" className="inline-flex items-center gap-2.5">
          <FairShareTile title="" className="size-11" />
          <span
            aria-hidden
            className="font-wordmark text-[30px] leading-none font-semibold tracking-[-0.01em]"
          >
            fairshare
          </span>
        </span>
        <div>
          <p className="max-w-[520px] text-[40px] leading-[48px] font-extrabold tracking-[-0.03em]">
            Keep track of shared expenses, so friends can settle up fairly.
          </p>
          <ul className="mt-5 flex flex-col gap-3.5 text-base leading-[23px]">
            {[
              'Split equally, by exact amounts, percentages or shares',
              'Record UPI, cash or bank payments',
              'See who pays whom to settle up',
            ].map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <CircleCheck aria-hidden className="mt-px size-5 shrink-0" strokeWidth={1.9} />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <span />
      </section>
      <main className="flex flex-1 flex-col px-6 pt-[88px] pb-8 lg:items-center lg:justify-center lg:px-6 lg:py-12">
        <div className="flex w-full max-w-[420px] flex-1 flex-col lg:flex-none">
          <FairShareLogo size="lg" />
          <div className="mt-9">
            <Outlet />
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-8 text-[13px] leading-5 text-muted-foreground lg:mt-7 lg:pt-0">
            <p>FairShare keeps track of shared expenses, so friends can settle up fairly.</p>
            <p>
              By continuing you agree to the{' '}
              <Link to="/terms" className="text-foreground underline underline-offset-4">
                terms of use
              </Link>
              . See the{' '}
              <Link to="/privacy" className="text-foreground underline underline-offset-4">
                privacy notice
              </Link>{' '}
              for how your data is handled.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
