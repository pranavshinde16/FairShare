import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { sessionQuery } from '../../features/auth/session';
import { ProfileForm } from '../../features/profile/profile-form';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { ThemeSetting } from '../../features/profile/theme-setting';
import { authClient } from '../../lib/auth-client';

export const Route = createFileRoute('/_authed/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const error = me.error ?? currencies.error;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {me.data ? <>Signed in as {me.data.email}</> : <Skeleton className="h-4 w-48" />}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState
              error={error}
              onRetry={() => void Promise.all([me.refetch(), currencies.refetch()])}
            />
          ) : me.data && currencies.data ? (
            <ProfileForm profile={me.data} currencies={currencies.data.items} />
          ) : (
            <div className="flex flex-col gap-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-11 w-full" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSetting />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <SignOutButton />
          <Link
            to="/privacy"
            className="inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Privacy notice
          </Link>
          <Link
            to="/terms"
            className="inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Terms of use
          </Link>
          <Link
            to="/settings/delete-account"
            className="inline-flex min-h-11 items-center px-2 text-sm text-destructive underline-offset-4 hover:underline"
          >
            Delete account
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function SignOutButton() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    // Drop everything cached for this person before anyone else uses the device.
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await router.navigate({ to: '/sign-in', replace: true });
  }

  return (
    <Button variant="outline" loading={signingOut} onClick={() => void signOut()}>
      {!signingOut && <LogOut aria-hidden />}
      Sign out
    </Button>
  );
}
