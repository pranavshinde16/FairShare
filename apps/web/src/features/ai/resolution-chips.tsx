import type { Group } from '@fairshare/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { HelpCircle, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { afterMembershipChange } from '../../lib/invalidation';
import type { Pending } from './entry';

/**
 * Names from a typed entry that still need an answer (Blueprint 8.7): "Which Rahul? [Rahul S]
 * [Rahul K]", or "Amit isn't in Goa Trip. [Add as new member] [Remove]". Save waits until none are
 * left.
 */
export function ResolutionChips({
  group,
  pending,
  onSettle,
  onRemove,
}: {
  group: Group;
  pending: Pending[];
  /** The name is this person (picked, or just added to the group). */
  onSettle: (item: Pending, userId: string) => void;
  onRemove: (item: Pending) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <ul aria-label="Names to check" className="flex flex-col gap-2">
      {pending.map((item) => (
        <li key={`${item.role} ${item.name}`}>
          <Chip group={group} item={item} onSettle={onSettle} onRemove={onRemove} />
        </li>
      ))}
    </ul>
  );
}

function Chip({
  group,
  item,
  onSettle,
  onRemove,
}: {
  group: Group;
  item: Pending;
  onSettle: (item: Pending, userId: string) => void;
  onRemove: (item: Pending) => void;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (userId: string) =>
    group.members.find((m) => m.user.id === userId)?.user.name ?? 'Someone';
  const paid = item.role === 'payer' ? ' (who paid)' : '';
  // A friendship has exactly two people: nobody can be added to it.
  const canAdd = group.kind === 'group';

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const member = await api.addMember(group.id, { name: item.name });
      await afterMembershipChange(queryClient, group.id);
      onSettle(item, member.user.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div
      role="group"
      aria-label={
        item.status === 'ambiguous' ? `Which ${item.name}?` : `${item.name} isn’t in the group`
      }
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
    >
      <p className="flex items-center gap-2 font-medium text-amber-950 dark:text-amber-100">
        <HelpCircle aria-hidden className="size-4 shrink-0" />
        {item.status === 'ambiguous'
          ? `Which ${item.name}${paid}?`
          : group.kind === 'group'
            ? `${item.name}${paid} isn’t in ${group.name}.`
            : `${item.name}${paid} isn’t in this friendship.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {item.status === 'ambiguous'
          ? item.candidates.map((userId) => (
              <Button
                key={userId}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSettle(item, userId)}
              >
                {nameOf(userId)}
              </Button>
            ))
          : canAdd && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={adding}
                onClick={() => void add()}
              >
                {!adding && <UserPlus aria-hidden />}
                Add as new member
              </Button>
            )}
        <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(item)}>
          <X aria-hidden />
          Remove
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
