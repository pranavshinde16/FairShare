import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { EmptyState } from '../../components/common/empty-state';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { meQuery } from '../../features/profile/queries';

export const Route = createFileRoute('/_authed/')({
  component: HomePage,
});

function HomePage() {
  const me = useQuery(meQuery);
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  const firstName = me.data?.name.split(' ')[0];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {firstName ? `Hi, ${firstName}` : <Skeleton className="h-8 w-40" />}
      </h1>
      <EmptyState icon={Users} title="No groups yet">
        Groups, friends and shared expenses are coming soon. You’ll see who owes whom right here.
      </EmptyState>
    </div>
  );
}
