import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useId, useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { Button } from '../../components/ui/button';
import { sessionQuery } from '../../features/auth/session';
import { homeQuery } from '../../features/balances/queries';
import { meQuery } from '../../features/profile/queries';
import { useOnline } from '../../lib/online';
import { api } from '../../lib/api';
import { errorMessage, errorRequestId } from '../../lib/errors';

export const Route = createFileRoute('/_authed/settings_/delete-account')({
  component: DeleteAccountPage,
});

/**
 * Account deletion (Blueprint 4.1): what happens, who I still owe or am owed (those balances stay
 * with the others), and a deliberate confirmation.
 */
function DeleteAccountPage() {
  const me = useQuery(meQuery);
  const home = useQuery(homeQuery);
  const queryClient = useQueryClient();
  const router = useRouter();
  const online = useOnline();
  const confirmId = useId();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMe();
    } catch (err) {
      setError(err);
      setBusy(false);
      return;
    }
    // Nothing of this person stays cached on the device.
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await router.navigate({ to: '/sign-in', search: { deleted: true }, replace: true });
  }

  const owing = home.data?.people.filter((p) => p.balances.length > 0) ?? [];
  const loadError = me.error ?? home.error;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Link
        to="/settings"
        className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Delete your account</h1>

      <section aria-labelledby="what-heading" className="flex flex-col gap-2">
        <h2 id="what-heading" className="text-lg font-semibold">
          What happens
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            Your name, email, picture and UPI ID are removed, and you’re signed out on every device.
          </li>
          <li>
            Expenses you were part of stay, so everyone else’s balances stay right. You’re shown in
            them as “Deleted user”.
          </li>
          <li>
            You leave every group where you’re settled up. Where you still owe or are owed, you stay
            as “Deleted user”, so the others can record what’s paid back.
          </li>
          <li>
            It can’t be undone. Signing in again with the same email starts a new, empty account.
          </li>
        </ul>
      </section>

      <section aria-labelledby="balances-heading" className="flex flex-col gap-3">
        <h2 id="balances-heading" className="text-lg font-semibold">
          Your balances
        </h2>
        {loadError ? (
          <ErrorState
            error={loadError}
            onRetry={() => void Promise.all([me.refetch(), home.refetch()])}
          />
        ) : !home.data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : owing.length === 0 ? (
          <p className="text-sm text-muted-foreground">You’re settled up with everyone.</p>
        ) : (
          <>
            <p className="text-sm">
              These aren’t settled. Settle up first if you can: once your account is gone, only the
              others can record payments.
            </p>
            <ul
              aria-label="Balances not settled"
              className="flex flex-col divide-y rounded-xl border"
            >
              {owing.map((friend) => (
                <li key={friend.user.id} className="flex items-center gap-3 p-3">
                  <Avatar name={friend.user.name} src={friend.user.avatarUrl} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {friend.user.name}
                  </span>
                  <BalanceText
                    balances={friend.balances}
                    kind="person"
                    className="text-right text-sm"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section
        aria-labelledby="confirm-heading"
        className="flex flex-col gap-4 rounded-xl border border-destructive/40 p-4"
      >
        <h2 id="confirm-heading" className="text-lg font-semibold">
          Delete {me.data ? me.data.email : 'your account'}
        </h2>
        <div className="flex items-start gap-3">
          <input
            id={confirmId}
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-destructive"
          />
          <label htmlFor={confirmId} className="text-sm">
            I understand that my account is deleted for good.
          </label>
        </div>
        {error !== null && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
            <p>{errorMessage(error)}</p>
            {errorRequestId(error) && (
              <p className="text-xs text-muted-foreground">Request ID: {errorRequestId(error)}</p>
            )}
          </div>
        )}
        <Button
          variant="destructive"
          className="self-start"
          disabled={!understood || !me.data || !online}
          loading={busy}
          onClick={() => void deleteAccount()}
        >
          Delete my account
        </Button>
      </section>
    </div>
  );
}
