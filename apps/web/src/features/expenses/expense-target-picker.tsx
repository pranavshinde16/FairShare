import type { Home } from '@fairshare/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Avatar } from '../../components/common/avatar';
import { GroupTile } from '../../components/common/tiles';
import { Dialog } from '../../components/ui/dialog';
import { CapsLabel, ListCard } from '../../components/ui/list-card';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { plural } from '../../lib/money';
import { afterMembershipChange } from '../../lib/invalidation';

/**
 * "＋ Expense" from Home: pick the group or the friend it's with, then the form opens over that
 * page. A person I only share groups with gets our friendship opened first.
 */
export function ExpenseTargetPicker({
  open,
  onClose,
  home,
}: {
  open: boolean;
  onClose: () => void;
  home: Home;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const withFriend = useMutation({
    mutationFn: async ({
      userId,
      directGroupId,
    }: {
      userId: string;
      directGroupId: string | null;
    }) => {
      if (directGroupId === null) {
        const { groupId } = await api.addFriend({ userId });
        await afterMembershipChange(queryClient, groupId);
      }
      return userId;
    },
    onSuccess: async (userId) => {
      onClose();
      await navigate({ to: '/friends/$userId/expenses/new', params: { userId } });
    },
  });

  const row =
    'flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-inset disabled:opacity-45';
  const chevron = (
    <ChevronRight aria-hidden className="size-[18px] text-muted-foreground" strokeWidth={1.9} />
  );
  return (
    <Dialog
      open={open}
      onClose={() => {
        withFriend.reset();
        onClose();
      }}
      title="Add expense"
      description="Who is it with?"
    >
      {withFriend.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(withFriend.error)}
        </p>
      )}
      {home.groups.length > 0 && (
        <section aria-label="Groups" className="flex flex-col gap-2">
          <CapsLabel>Groups</CapsLabel>
          <ListCard inset="avatar">
            {home.groups.map(({ group }) => (
              <li key={group.id}>
                <button
                  type="button"
                  className={row}
                  onClick={() => {
                    onClose();
                    void navigate({
                      to: '/groups/$groupId/expenses/new',
                      params: { groupId: group.id },
                    });
                  }}
                >
                  <GroupTile
                    emoji={group.emoji}
                    name={group.name ?? ''}
                    seed={group.id}
                    size={40}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base leading-[21px] font-bold break-words">
                      {group.name}
                    </span>
                    <span className="text-[13px] leading-[18px] text-muted-foreground">
                      {plural(
                        group.members.filter((m) => m.leftAt === null).length,
                        'person',
                        'people',
                      )}
                    </span>
                  </span>
                  {chevron}
                </button>
              </li>
            ))}
          </ListCard>
        </section>
      )}
      {home.people.length > 0 && (
        <section aria-label="People" className="flex flex-col gap-2">
          <CapsLabel>People</CapsLabel>
          <ListCard inset="avatar">
            {home.people.map(({ user, directGroupId }) => (
              <li key={user.id}>
                <button
                  type="button"
                  className={row}
                  disabled={withFriend.isPending}
                  onClick={() => withFriend.mutate({ userId: user.id, directGroupId })}
                >
                  <Avatar
                    name={user.name}
                    src={user.avatarUrl}
                    seed={user.id}
                    deleted={user.isDeleted}
                    size={40}
                  />
                  <span className="min-w-0 flex-1 text-base leading-[21px] font-bold break-words">
                    {user.name}
                  </span>
                  {chevron}
                </button>
              </li>
            ))}
          </ListCard>
        </section>
      )}
      {home.groups.length === 0 && home.people.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Start a group or add a friend first; expenses are always shared with someone.
        </p>
      )}
    </Dialog>
  );
}
