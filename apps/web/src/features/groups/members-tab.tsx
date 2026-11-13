import type { Group, Member } from '@fairshare/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { ConfirmDialog } from '../../components/common/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { InviteButton } from './invite-button';
import { PersonPicker } from './person-picker';
import { useAddMember } from './queries';
import { groupTitle } from './title';

/** Blueprint 7.2 Members tab: who's in, who hasn't joined, invite, add, remove, leave. */
export function MembersTab({ group, meId }: { group: Group; meId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const regular = group.kind === 'group';
  const owner = group.myRole === 'owner';
  const active = group.members.filter((m) => m.leftAt === null);
  const former = group.members.filter((m) => m.leftAt !== null);
  const title = groupTitle(group, meId);

  return (
    <div className="flex flex-col gap-6">
      {regular && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden />
            Add person
          </Button>
          <InviteButton variant="outline" groupId={group.id} groupName={title} />
        </div>
      )}

      <ul aria-label="Members" className="flex flex-col divide-y rounded-xl border">
        {active.map((member) => (
          <li key={member.user.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <Avatar
              name={member.user.name}
              src={member.user.avatarUrl}
              seed={member.user.id}
              deleted={member.user.isDeleted}
              size={44}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                {member.user.name}
                {member.user.id === meId && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {member.role === 'owner'
                  ? 'Owner'
                  : member.user.isDeleted
                    ? 'Account deleted · stays until settled'
                    : member.user.isPlaceholder
                      ? 'Not joined yet'
                      : 'Member'}
              </span>
            </div>
            {(member.user.isPlaceholder || (regular && owner && member.user.id !== meId)) && (
              // On phones the actions take their own line, so the name keeps its width.
              <div className="flex w-full justify-end gap-1 sm:w-auto">
                {member.user.isPlaceholder && (
                  <InviteButton
                    size="sm"
                    variant="ghost"
                    groupId={group.id}
                    groupName={title}
                    placeholder={{ id: member.user.id, name: member.user.name }}
                  />
                )}
                {regular && owner && member.user.id !== meId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${member.user.name}`}
                    onClick={() => setRemoving(member)}
                  >
                    <UserX aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {former.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Former members ({former.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2 pl-2">
            {former.map((member) => (
              <li key={member.user.id} className="flex items-center gap-3 text-muted-foreground">
                <Avatar
                  name={member.user.name}
                  src={member.user.avatarUrl}
                  seed={member.user.id}
                  deleted={member.user.isDeleted}
                  size={32}
                />
                {member.user.name}
              </li>
            ))}
          </ul>
        </details>
      )}

      {regular && (
        <div>
          <Button variant="outline" onClick={() => setLeaving(true)}>
            <LogOut aria-hidden />
            Leave group
          </Button>
        </div>
      )}

      <AddPersonDialog
        open={adding}
        onClose={() => setAdding(false)}
        groupId={group.id}
        exclude={active.map((m) => m.user.id)}
      />
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.user.name ?? ''}?`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          await api.removeMember(group.id, removing!.user.id);
          await afterMembershipChange(queryClient, group.id);
        }}
      >
        They must be settled up first. Their past expenses stay, under their name.
      </ConfirmDialog>
      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={`Leave ${title}?`}
        confirmLabel="Leave"
        destructive
        onConfirm={async () => {
          await api.removeMember(group.id, 'me');
          queryClient.removeQueries({ queryKey: ['group', group.id] });
          await afterMembershipChange(queryClient, group.id);
          await navigate({ to: '/' });
        }}
      >
        You must be settled up first. {owner && 'The longest-standing member becomes the owner. '}
        If nobody else in the group has an account, the group is closed.
      </ConfirmDialog>
    </div>
  );
}

function AddPersonDialog({
  open,
  onClose,
  groupId,
  exclude,
}: {
  open: boolean;
  onClose: () => void;
  groupId: string;
  exclude: string[];
}) {
  const add = useAddMember(groupId);
  return (
    <Dialog
      open={open}
      onClose={() => {
        add.reset();
        onClose();
      }}
      title="Add a person"
      description="They can join later with an invite link, or claim their place by signing up with the email you enter."
    >
      {add.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(add.error)}
        </p>
      )}
      <PersonPicker
        exclude={exclude}
        submitLabel="Add"
        busy={add.isPending}
        onPick={(member) => add.mutate(member, { onSuccess: onClose })}
      />
    </Dialog>
  );
}
