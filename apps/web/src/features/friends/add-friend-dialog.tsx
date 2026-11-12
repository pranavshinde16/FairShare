import type { NewMember } from '@fairshare/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from '../../components/ui/dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { PersonPicker } from '../groups/person-picker';
import { afterMembershipChange } from '../../lib/invalidation';

/**
 * Blueprint 6 "Adding friends": a name (and maybe an email), or someone I know. Opens the
 * friendship, where expenses can be added right away, before the friend joins.
 */
export function AddFriendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const add = useMutation({
    mutationFn: (friend: NewMember) => api.addFriend(friend),
    onSuccess: async ({ groupId, friend }) => {
      await afterMembershipChange(queryClient, groupId);
      onClose();
      await navigate({ to: '/friends/$userId', params: { userId: friend.id } });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        add.reset();
        onClose();
      }}
      title="Add a friend"
      description="For expenses between the two of you, outside any group."
    >
      {add.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(add.error)}
        </p>
      )}
      <PersonPicker
        submitLabel="Add friend"
        busy={add.isPending}
        onPick={(friend) => add.mutate(friend)}
      />
    </Dialog>
  );
}
