import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { claimsQuery, refreshMemberships } from '../groups/queries';

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
      await refreshMemberships(queryClient);
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
    <section aria-label="Groups waiting for you" className="flex flex-col gap-3">
      {items.map(({ placeholder, addedBy, groups }) => {
        const where = groups
          .map((g) => (g.kind === 'direct' ? 'a friendship' : `${g.emoji ?? ''} ${g.name}`.trim()))
          .join(', ');
        return (
          <div
            key={placeholder.id}
            className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-accent p-4"
          >
            <p className="text-sm text-accent-foreground">
              {addedBy.name} added you to <strong>{where}</strong> as “{placeholder.name}”. Is that
              you?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                loading={claim.isPending && claim.variables === placeholder.id}
                onClick={() => claim.mutate(placeholder.id)}
              >
                That’s me
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={dismiss.isPending && dismiss.variables === placeholder.id}
                onClick={() => dismiss.mutate(placeholder.id)}
              >
                Not me
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
