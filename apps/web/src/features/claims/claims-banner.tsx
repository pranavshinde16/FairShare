import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { UserRound, X } from 'lucide-react';
import { GroupTile } from '../../components/common/tiles';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { cn } from '../../lib/utils';
import { claimsQuery } from '../groups/queries';

/**
 * Placeholders someone made with my email address (plan correction): "Asha added you to Goa Trip
 * as ‘Bilal’." Claiming joins those groups as that person; "Not me" removes the email hint.
 */
export function ClaimsBanner({
  className,
  compact = false,
}: {
  className?: string;
  /** The desktop rail's narrow version: the text above its actions. */
  compact?: boolean;
}) {
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
    <section aria-label="Groups waiting for you" className={cn('flex flex-col gap-2.5', className)}>
      {items.map(({ placeholder, addedBy, groups }) => {
        const where = groups
          .map((g) => (g.kind === 'direct' ? 'a friendship' : (g.name ?? '')))
          .join(', ');
        const first = groups[0];
        return (
          <div
            key={placeholder.id}
            className={cn(
              'flex gap-3 rounded-xl border bg-card py-2.5 pr-1.5 pl-3 shadow-card',
              compact ? 'flex-wrap items-center' : 'items-center',
            )}
          >
            {first && first.kind === 'group' ? (
              <GroupTile emoji={first.emoji} name={first.name ?? ''} seed={first.id} size={40} />
            ) : (
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-accent text-accent-foreground">
                <UserRound aria-hidden className="size-5" strokeWidth={1.9} />
              </span>
            )}
            <p className={cn('min-w-0 flex-1 text-sm leading-5', compact && 'pt-0.5')}>
              <b>{addedBy.name}</b> added you to <b>{where}</b> as “{placeholder.name}”
            </p>
            <div
              className={cn('flex shrink-0 items-center gap-1', compact && 'basis-full pl-[52px]')}
            >
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
