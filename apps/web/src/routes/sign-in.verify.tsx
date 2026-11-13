import { createFileRoute, redirect } from '@tanstack/react-router';
import { CodeStep } from '../features/auth/code-step';
import { pendingSignIn } from '../features/auth/session';

export const Route = createFileRoute('/sign-in/verify')({
  // Without an address to check a code for (a new tab, a bookmark), start over.
  beforeLoad: ({ search }) => {
    if (!pendingSignIn.get()) throw redirect({ to: '/sign-in', search, replace: true });
  },
  component: VerifyPage,
});

function VerifyPage() {
  const { returnTo } = Route.useSearch();
  const pending = pendingSignIn.get();
  if (!pending) return null; // beforeLoad has redirected

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] leading-9 font-extrabold tracking-[-0.03em]">
          Check your email
        </h1>
        <p className="text-[15px] leading-[22px] text-muted-foreground">
          Enter the 6-digit code we sent to{' '}
          <span className="font-bold break-all text-foreground">{pending.email}</span>. It expires
          in 5 minutes.
        </p>
      </div>
      <CodeStep pending={pending} returnTo={returnTo} />
    </div>
  );
}
