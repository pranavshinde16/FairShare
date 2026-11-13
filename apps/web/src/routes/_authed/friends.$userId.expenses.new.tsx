import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { friendQuery } from '../../features/balances/queries';
import { Dialog } from '../../components/ui/dialog';
import { FormSkeleton, NewExpenseDialog } from '../../features/expenses/new-expense-dialog';
import { useCloseModal } from '../../lib/modal-route';

/** Add an expense between me and a friend: a modal route over the friend's page. */
export const Route = createFileRoute('/_authed/friends/$userId/expenses/new')({
  component: NewFriendExpense,
});

function NewFriendExpense() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const friend = useQuery(friendQuery(userId));
  const close = useCloseModal(
    () => void navigate({ to: '/friends/$userId', params: { userId }, replace: true }),
  );
  // The friend page opens the friendship before coming here; a stale link without one goes back.
  const missing = friend.isSuccess && friend.data.directGroupId === null;
  useEffect(() => {
    if (missing) close();
  });
  if (missing || friend.isError) return null;
  const groupId = friend.data?.directGroupId;
  return groupId ? (
    <NewExpenseDialog groupId={groupId} onClose={close} />
  ) : (
    <Dialog open size="full" title="Add expense" onClose={close}>
      <FormSkeleton />
    </Dialog>
  );
}
