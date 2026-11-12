import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { NewSettlementDialog } from '../../features/settlements/settle-dialog';

const SettleSearch = z.object({
  /** A suggested payment to pre-fill: who pays and who is paid. */
  from: z.uuid().optional().catch(undefined),
  to: z.uuid().optional().catch(undefined),
});

/** Settle payment (Blueprint 7.2): a modal route over the group, so Back closes it. */
export const Route = createFileRoute('/_authed/groups/$groupId/settle')({
  validateSearch: SettleSearch,
  component: SettleInGroup,
});

function SettleInGroup() {
  const { groupId } = Route.useParams();
  const { tab, from, to } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <NewSettlementDialog
      groupId={groupId}
      from={from}
      to={to}
      onClose={() =>
        void navigate({ to: '/groups/$groupId', params: { groupId }, search: { tab } })
      }
    />
  );
}
