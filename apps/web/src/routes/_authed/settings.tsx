import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { ChevronRight, FileText, Info, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Avatar } from '../../components/common/avatar';
import { Spinner } from '../../components/common/spinner';
import { PageLayout, PageTitle } from '../../components/layout/page';
import { ListCard } from '../../components/ui/list-card';
import { cn } from '../../lib/utils';
import { sessionQuery } from '../../features/auth/session';
import { ProfileForm } from '../../features/profile/profile-form';
import { currenciesQuery, meQuery } from '../../features/profile/queries';
import { ThemeSetting } from '../../features/profile/theme-setting';
import { authClient } from '../../lib/auth-client';

export const Route = createFileRoute('/_authed/settings')({
  component: SettingsPage,
});

/** Account (DESIGN_SPEC §5 m-account, d-account): profile, appearance, and the account's links. */
function SettingsPage() {
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const error = me.error ?? currencies.error;
  const section = 'mt-2 text-lg leading-6 font-extrabold tracking-[-0.01em]';
  const linkRow =
    'flex min-h-[54px] w-full items-center gap-3 px-4 text-[15px] font-semibold outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset';
  const chevron = (
    <ChevronRight aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={1.9} />
  );

  return (
    <PageLayout className="lg:max-w-[1040px]">
      <PageTitle>Account</PageTitle>

      {/* Desktop (d-account): the profile on the left, appearance and the links on the right. */}
      <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-x-7">
        <div className="flex flex-col gap-3.5">
          <h2 className={cn(section, 'lg:mt-0 lg:text-base')}>Profile</h2>
          <section aria-label="Profile" className="rounded-xl border bg-card p-[18px] shadow-card">
            <div className="flex items-center gap-3.5">
              {me.data ? (
                <Avatar name={me.data.name} src={me.data.avatarUrl} seed={me.data.id} size={56} />
              ) : (
                <Skeleton className="size-14 rounded-full" />
              )}
              <div className="min-w-0">
                {me.data ? (
                  <>
                    <p className="text-lg font-extrabold break-words">{me.data.name}</p>
                    <p className="mt-0.5 text-[13px] leading-5 break-all text-muted-foreground">
                      Signed in as {me.data.email}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                )}
              </div>
            </div>
            <div aria-hidden className="my-4 h-px bg-border" />
            {error ? (
              <ErrorState
                error={error}
                onRetry={() => void Promise.all([me.refetch(), currencies.refetch()])}
              />
            ) : me.data && currencies.data ? (
              <ProfileForm profile={me.data} currencies={currencies.data.items} />
            ) : (
              <div className="flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-3.5 lg:gap-0.5 lg:rounded-xl lg:border lg:bg-card lg:p-4 lg:shadow-card">
            <h2 className={cn(section, 'lg:mt-0 lg:text-base')}>Appearance</h2>
            <section
              aria-label="Appearance"
              className="rounded-xl border bg-card p-4 shadow-card lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
            >
              <p className="mb-3 text-[13px] leading-5 text-muted-foreground">
                Saved on this device.
              </p>
              <ThemeSetting />
            </section>
          </div>

          <h2 className={cn(section, 'lg:text-base')}>Account</h2>
          <ListCard inset="none" aria-label="Account" className="[&>li+li]:before:left-12">
            <li>
              <SignOutButton className={linkRow} />
            </li>
            <li>
              <Link to="/privacy" className={linkRow}>
                <Info aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.9} />
                <span className="flex-1">Privacy notice</span>
                {chevron}
              </Link>
            </li>
            <li>
              <Link to="/terms" className={linkRow}>
                <FileText aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.9} />
                <span className="flex-1">Terms of use</span>
                {chevron}
              </Link>
            </li>
            <li>
              <Link to="/settings/delete-account" className={cn(linkRow, 'text-destructive')}>
                <Trash2 aria-hidden className="size-5" strokeWidth={1.9} />
                <span className="flex-1">Delete account</span>
              </Link>
            </li>
          </ListCard>
        </div>
      </div>
    </PageLayout>
  );
}

function SignOutButton({ className }: { className?: string }) {
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
    <button
      type="button"
      className={className}
      disabled={signingOut}
      aria-busy={signingOut || undefined}
      onClick={() => void signOut()}
    >
      {signingOut ? (
        <Spinner className="size-5 text-muted-foreground" />
      ) : (
        <LogOut aria-hidden className="size-5 text-muted-foreground" strokeWidth={1.9} />
      )}
      <span className="flex-1 text-left">Sign out</span>
      <ChevronRight aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={1.9} />
    </button>
  );
}
