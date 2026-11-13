import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { CircleCheck, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { BalanceText } from '../../components/common/balance-text';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { BackLink, PageLayout } from '../../components/layout/page';
import { Button } from '../../components/ui/button';
import { ListCard } from '../../components/ui/list-card';
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
    <PageLayout>
      <BackLink to="/settings" desktop>
        Account
      </BackLink>
      <h1 className="text-[26px] leading-8 font-extrabold tracking-[-0.02em] lg:text-[30px] lg:leading-9">
        Delete your account
      </h1>

      <section
        aria-labelledby="what-heading"
        className="flex flex-col gap-2.5 rounded-xl border bg-card p-[18px] shadow-card"
      >
        <h2 id="what-heading" className="text-lg leading-6 font-extrabold">
          What happens
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-[22px]">
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

      <section aria-labelledby="balances-heading" className="flex flex-col gap-2.5">
        <h2 id="balances-heading" className="mt-1 text-lg leading-6 font-extrabold">
          Your balances
        </h2>
        {loadError ? (
          <ErrorState
            error={loadError}
            onRetry={() => void Promise.all([me.refetch(), home.refetch()])}
          />
        ) : !home.data ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : owing.length === 0 ? (
          <p className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3.5 text-[15px] font-semibold shadow-card">
            <CircleCheck aria-hidden className="size-5 text-owed" strokeWidth={1.9} />
            You’re settled up with everyone.
          </p>
        ) : (
          <>
            <p className="text-[15px] leading-[22px] text-muted-foreground">
              These aren’t settled. Settle up first if you can: once your account is gone, only the
              others can record payments.
            </p>
            <ListCard inset="avatar" aria-label="Balances not settled">
              {owing.map((friend) => (
                <li key={friend.user.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <Avatar
                    name={friend.user.name}
                    src={friend.user.avatarUrl}
                    seed={friend.user.id}
                    deleted={friend.user.isDeleted}
                  />
                  <span className="min-w-0 flex-1 text-[15px] font-bold break-words">
                    {friend.user.name}
                  </span>
                  <BalanceText balances={friend.balances} kind="person" layout="stacked" />
                </li>
              ))}
            </ListCard>
          </>
        )}
      </section>

      <section
        aria-labelledby="confirm-heading"
        className="flex flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive-muted p-[18px]"
      >
        <h2 id="confirm-heading" className="text-lg leading-6 font-extrabold break-all">
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
          <label htmlFor={confirmId} className="text-[15px] leading-[22px] font-semibold">
            I understand that my account is deleted for good.
          </label>
        </div>
        {error !== null && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
            <p className="font-semibold">{errorMessage(error)}</p>
            {errorRequestId(error) && (
              <p className="text-xs text-muted-foreground">Request ID: {errorRequestId(error)}</p>
            )}
          </div>
        )}
        <Button
          variant="destructive"
          size="md"
          className="self-start"
          disabled={!understood || !me.data || !online}
          loading={busy}
          onClick={() => void deleteAccount()}
        >
          <Trash2 aria-hidden strokeWidth={1.9} />
          Delete my account
        </Button>
      </section>
    </PageLayout>
  );
}
