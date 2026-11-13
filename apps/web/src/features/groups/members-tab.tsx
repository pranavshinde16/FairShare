import type { Group, Member } from '@fairshare/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut, UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '../../components/common/avatar';
import { ConfirmDialog } from '../../components/common/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ListCard } from '../../components/ui/list-card';
import { balancesQuery } from '../balances/queries';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import { useFormatMoney } from '../../lib/money';
import { InviteButton } from './invite-button';
import { PersonPicker } from './person-picker';
import { useAddMember } from './queries';
import { groupTitle } from './title';

/**
 * The Members tab (DESIGN_SPEC §5 m-group-members, d-group-members): who's in, who hasn't joined
 * yet, invite, add, remove (the owner), leave. Removing someone who still owes or is owed money is
 * blocked, with the amount shown (§6.2).
 */
export function MembersTab({ group, meId }: { group: Group; meId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const balances = useQuery(balancesQuery(group.id));
  const format = useFormatMoney();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const regular = group.kind === 'group';
  const owner = group.myRole === 'owner';
  const active = group.members.filter((m) => m.leftAt === null);
  const former = group.members.filter((m) => m.leftAt !== null);
  const title = groupTitle(group, meId);

  // §6.2: what the person being removed still owes or is owed here, per currency.
  const outstanding = removing
    ? (balances.data?.balances ?? []).flatMap((entry) => {
        const net = entry.nets.find((n) => n.userId === removing.user.id)?.amount ?? 0;
        return net === 0 ? [] : [{ amount: net, currency: entry.currency }];
      })
    : [];
  const removeNotice =
    removing && outstanding.length > 0
      ? `${removing.user.name} ${outstanding
          .map((money) => (money.amount < 0 ? `owes ${format(money)}` : `is owed ${format(money)}`))
          .join(' and ')} in this group, so they can’t be removed yet.`
      : null;

  return (
    <div className="flex flex-col gap-3.5">
      {regular && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden strokeWidth={1.9} />
            Add person
          </Button>
          <InviteButton variant="secondary" size="sm" groupId={group.id} groupName={title} />
        </div>
      )}

      <ListCard inset="person" aria-label="Members">
        {active.map((member) => {
          const canRemove = regular && owner && member.user.id !== meId;
          return (
            <li key={member.user.id} className="flex min-h-14 items-center gap-3 px-3.5 py-3">
              <Avatar
                name={member.user.name}
                src={member.user.avatarUrl}
                seed={member.user.id}
                deleted={member.user.isDeleted}
                size={44}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-base leading-[21px] font-bold break-words">
                  {member.user.name}
                  {member.user.id === meId && (
                    <span className="font-medium text-muted-foreground"> (you)</span>
                  )}
                </span>
                <span className="text-[13px] leading-[18px] text-muted-foreground">
                  {member.role === 'owner'
                    ? 'Owner'
                    : member.user.isDeleted
                      ? 'Account deleted · stays until settled'
                      : member.user.isPlaceholder
                        ? 'Not joined yet'
                        : 'Member'}
                </span>
              </div>
              {(member.user.isPlaceholder || canRemove) && (
                <div className="flex shrink-0 items-start gap-1.5">
                  {member.user.isPlaceholder && (
                    <InviteButton
                      size="sm"
                      variant="tint"
                      groupId={group.id}
                      groupName={title}
                      placeholder={{ id: member.user.id, name: member.user.name }}
                      label="Invite"
                      aria-label={`Invite ${member.user.name}`}
                    />
                  )}
                  {canRemove && (
                    // An icon on phones, labelled on desktop (DESIGN_SPEC §4 MemberRow).
                    <Button
                      size="icon"
                      variant="plain"
                      aria-label={`Remove ${member.user.name}`}
                      className="rounded-full text-muted-foreground lg:h-9 lg:w-auto lg:rounded-md lg:border lg:bg-card lg:px-3 lg:text-[13px] lg:text-foreground"
                      onClick={() => setRemoving(member)}
                    >
                      <UserX aria-hidden strokeWidth={1.9} />
                      <span className="hidden lg:inline">Remove</span>
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ListCard>

      {former.length > 0 && (
        <details className="group rounded-xl border bg-card shadow-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
            <span className="flex-1">Former members ({former.length})</span>
            <ChevronDown
              aria-hidden
              className="size-[18px] transition-transform group-open:rotate-180 motion-reduce:transition-none"
              strokeWidth={1.9}
            />
          </summary>
          <ul className="flex flex-col gap-2 px-4 pb-3.5">
            {former.map((member) => (
              <li
                key={member.user.id}
                className="flex items-center gap-3 text-sm text-muted-foreground"
              >
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
          <Button variant="secondary" size="md" onClick={() => setLeaving(true)}>
            <LogOut aria-hidden strokeWidth={1.9} />
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
        icon={UserX}
        notice={removeNotice}
        // Blocked while they're owed or owe (§6.2), and until their balance has loaded.
        confirmDisabled={removeNotice !== null || !balances.data}
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
        icon={LogOut}
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
        list
        busy={add.isPending}
        onPick={(member) => add.mutate(member, { onSuccess: onClose })}
      />
    </Dialog>
  );
}
