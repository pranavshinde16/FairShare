import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCloseModal } from '../../lib/modal-route';
import { NewExpenseDialog } from '../../features/expenses/new-expense-dialog';

/** Add expense: a modal route over the group (Blueprint 7.3), so Back closes it. */
export const Route = createFileRoute('/_authed/groups/$groupId/expenses/new')({
  component: NewGroupExpense,
});

function NewGroupExpense() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const close = useCloseModal(
    () =>
      void navigate({
        to: '/groups/$groupId',
        params: { groupId },
        search: { tab: 'expenses' },
        replace: true,
      }),
  );
  return <NewExpenseDialog groupId={groupId} onClose={close} />;
}
