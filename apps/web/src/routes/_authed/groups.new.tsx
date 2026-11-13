import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { ErrorState } from '../../components/common/error-state';
import { Skeleton } from '../../components/common/skeleton';
import { PageLayout } from '../../components/layout/page';
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
    <PageLayout>
      {/* Phones: a create flow's header, ✕ left and the title centred (DESIGN_SPEC §2). */}
      <header className="-mx-2 flex items-center gap-1 lg:mx-0">
        <Link
          to="/"
          aria-label="Close"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring lg:hidden"
        >
          <X aria-hidden className="size-5" strokeWidth={1.9} />
        </Link>
        <h1 className="min-w-0 flex-1 text-center text-[17px] font-extrabold lg:text-left lg:text-[30px] lg:leading-9 lg:tracking-[-0.03em]">
          New group
        </h1>
        <span aria-hidden className="w-11 shrink-0 lg:hidden" />
      </header>
      {error ? (
        <ErrorState
          error={error}
          onRetry={() => void Promise.all([me.refetch(), currencies.refetch()])}
        />
      ) : me.data && currencies.data ? (
        <CreateGroupForm me={me.data} currencies={currencies.data.items} />
      ) : (
        <div className="flex flex-col gap-[18px]">
          <Skeleton className="h-[74px] w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-[74px] w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
    </PageLayout>
  );
}
