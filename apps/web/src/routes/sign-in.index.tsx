import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { EmailStep } from '../features/auth/email-step';
import { googleErrorMessage } from '../features/auth/errors';
import { GoogleButton } from '../features/auth/google-button';
import { api } from '../lib/api';

export const Route = createFileRoute('/sign-in/')({
  component: SignInPage,
});

function SignInPage() {
  const { returnTo, error, deleted } = Route.useSearch();
  const options = useQuery({
    queryKey: ['sign-in-options'],
    queryFn: ({ signal }) => api.signInOptions(signal),
    staleTime: Infinity,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] leading-9 font-extrabold tracking-[-0.03em]">Sign in</h1>
        <p className="text-[15px] leading-[22px] text-muted-foreground">
          We’ll email you a 6-digit code. No password needed.
        </p>
      </div>
      {deleted && (
        <p role="status" className="rounded-lg bg-muted px-3.5 py-3 text-[15px] leading-[22px]">
          Your account was deleted. Thanks for using FairShare.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive-muted px-3.5 py-3 text-[15px] leading-[22px] text-destructive"
        >
          {googleErrorMessage(error)}
        </p>
      )}
      <EmailStep returnTo={returnTo} />
      {options.data?.google && (
        <>
          <div className="-my-1 flex items-center gap-3 text-[13px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleButton returnTo={returnTo} />
        </>
      )}
    </div>
  );
}
