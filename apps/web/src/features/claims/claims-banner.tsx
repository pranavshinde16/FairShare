import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { UserRound, X } from 'lucide-react';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { claimsQuery } from '../groups/queries';

/**
 * Placeholders someone made with my email address (plan correction): "Asha added you to Goa Trip
 * as ‘Bilal’." Claiming joins those groups as that person; "Not me" removes the email hint.
 */
export function ClaimsBanner() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const claims = useQuery(claimsQuery);
  const claim = useMutation({
    mutationFn: (placeholderId: string) => api.claim(placeholderId),
    onSuccess: async ({ groupIds }) => {
      // A claim moves the placeholder's part in every group it was in.
      await afterMembershipChange(queryClient);
      const [first] = groupIds;
      if (first) await navigate({ to: '/groups/$groupId', params: { groupId: first } });
    },
  });
  const dismiss = useMutation({
    mutationFn: (placeholderId: string) => api.dismissClaim(placeholderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: claimsQuery.queryKey }),
  });

  const items = claims.data?.items ?? [];
  if (items.length === 0) return null;
  const error = claim.error ?? dismiss.error;

  return (
    <section aria-label="Groups waiting for you" className="flex flex-col gap-2.5">
      {items.map(({ placeholder, addedBy, groups }) => {
        const where = groups
          .map((g) => (g.kind === 'direct' ? 'a friendship' : (g.name ?? '')))
          .join(', ');
        const first = groups[0];
        return (
          <div
            key={placeholder.id}
            className="flex items-center gap-3 rounded-xl border bg-card py-2.5 pr-1.5 pl-3 shadow-card"
          >
            {first && first.kind === 'group' ? (
              <GroupTile emoji={first.emoji} name={first.name ?? ''} seed={first.id} size={40} />
            ) : (
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-accent text-accent-foreground">
                <UserRound aria-hidden className="size-5" strokeWidth={1.9} />
              </span>
            )}
            <p className="min-w-0 flex-1 text-sm leading-5">
              <b>{addedBy.name}</b> added you to <b>{where}</b> as “{placeholder.name}”. Is that
              you?
            </p>
            <Button
              size="sm"
              variant="tint"
              loading={claim.isPending && claim.variables === placeholder.id}
              onClick={() => claim.mutate(placeholder.id)}
            >
              That’s me
            </Button>
            <Button
              size="icon"
              variant="plain"
              aria-label="Not me"
              className="rounded-full text-muted-foreground"
              loading={dismiss.isPending && dismiss.variables === placeholder.id}
              onClick={() => dismiss.mutate(placeholder.id)}
            >
              {!(dismiss.isPending && dismiss.variables === placeholder.id) && (
                <X aria-hidden strokeWidth={1.9} />
              )}
            </Button>
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}
