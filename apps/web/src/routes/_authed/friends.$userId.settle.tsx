import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';
import { friendQuery } from '../../features/balances/queries';
import { meQuery } from '../../features/profile/queries';
import { NewSettlementDialog } from '../../features/settlements/settle-dialog';
import { useCloseModal } from '../../lib/modal-route';

const SettleSearch = z.object({
  /** The group to settle in: friends settle one group at a time (C5). */
  groupId: z.uuid().optional().catch(undefined),
});

/**
 * Settle up with a friend in one shared group, a modal route over the friend's page. Who pays whom
 * follows the friend page's balance for that group.
 */
export const Route = createFileRoute('/_authed/friends/$userId/settle')({
  validateSearch: SettleSearch,
  component: SettleWithFriend,
});

function SettleWithFriend() {
  const { userId } = Route.useParams();
  const { groupId } = Route.useSearch();
  const navigate = useNavigate();
  const friend = useQuery(friendQuery(userId));
  const me = useQuery(meQuery);
  const close = useCloseModal(
    () => void navigate({ to: '/friends/$userId', params: { userId }, replace: true }),
  );

  const entry = friend.data?.breakdown.find((b) => b.groupId === groupId);
  // A link to a group we don't share (or none at all) goes back to the friend page.
  const missing = !groupId || friend.isError || (friend.isSuccess && !entry);
  useEffect(() => {
    if (missing) close();
  });
  if (missing || !groupId || !me.data) return null;
  if (!entry) return null;

  // Positive: they owe me, so they pay me.
  const theyPay = entry.balance.amount > 0;
  return (
    <NewSettlementDialog
      groupId={groupId}
      from={theyPay ? userId : me.data.id}
      to={theyPay ? me.data.id : userId}
      onClose={close}
    />
  );
}
