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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          We’ll email you a 6-digit code. No password needed.
        </p>
      </div>
      {deleted && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          Your account was deleted. Thanks for using FairShare.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {googleErrorMessage(error)}
        </p>
      )}
      <EmailStep returnTo={returnTo} />
      {options.data?.google && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
