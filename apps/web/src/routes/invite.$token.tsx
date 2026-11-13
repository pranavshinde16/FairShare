import { ApiError } from '@fairshare/api-client';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Link2Off } from 'lucide-react';
import { ErrorState } from '../components/common/error-state';
import { Logo } from '../components/common/logo';
import { Skeleton } from '../components/common/skeleton';
import { sessionQuery } from '../features/auth/session';
import { InviteView, Message } from '../features/invites/invite-view';
import { api } from '../lib/api';

/** Public: shows what the link leads to before anyone signs in. */
export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const session = useQuery(sessionQuery);
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: ({ signal }) => api.invitePreview(token, signal),
    retry: false,
  });

  let body;
  if (preview.error instanceof ApiError && preview.error.status === 404) {
    body = (
      <Message icon={Link2Off} title="This invite link doesn’t work">
        It may have been revoked, or the group closed. Ask for a new link.
      </Message>
    );
  } else if (preview.error) {
    body = <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />;
  } else if (!preview.data || session.isPending) {
    body = <Skeleton className="h-72 w-full rounded-2xl" />;
  } else {
    body = <InviteView token={token} preview={preview.data} signedIn={!!session.data} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-7 px-6 py-10 lg:px-0">
      <Logo size="lg" />
      {body}
    </main>
  );
}
