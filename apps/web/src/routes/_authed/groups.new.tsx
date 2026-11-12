import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { CreateGroupForm } from '../../features/groups/create-group-form';
import { currenciesQuery, meQuery } from '../../features/profile/queries';

export const Route = createFileRoute('/_authed/groups/new')({
  component: NewGroupPage,
});

function NewGroupPage() {
  const me = useQuery(meQuery);
  const currencies = useQuery(currenciesQuery);
  const error = me.error ?? currencies.error;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">New group</h1>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void Promise.all([me.refetch(), currencies.refetch()])}
        />
      ) : me.data && currencies.data ? (
        <CreateGroupForm me={me.data} currencies={currencies.data.items} />
      ) : (
        <Skeleton className="h-96 w-full rounded-xl" />
      )}
    </div>
  );
}
