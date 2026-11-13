import type { Home } from '@fairshare/contracts';
import { chooseGroup, parseRules, type GroupCandidate } from '@fairshare/core';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { localDate } from '../expenses/expense-form';
import { handOff } from './handoff';

/**
 * "Type it" on Home (Blueprint 7.2 AiEntryBar, 8.6 "Group selection"): the sentence picks its
 * group from the names in it, and that group's Add expense form opens with the sentence read in,
 * where the person reviews it and saves.
 */
export function HomeEntry({ home, me }: { home: Home; me: { id: string; name: string } }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const sentence = text.trim();
    if (!sentence || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Groups with their current members (Home lists groups without them).
      const { items } = await queryClient.fetchQuery({
        queryKey: ['groups', 'for-entry'],
        queryFn: ({ signal }) => api.groups(signal),
        staleTime: 0,
      });
      const lastActivity = new Map(home.groups.map((g) => [g.group.id, g.lastActivityAt]));
      const candidates: GroupCandidate[] = [
        ...items.map((g) => ({
          id: g.id,
          kind: 'group' as const,
          members: g.members
            .filter((m) => m.leftAt === null)
            .map((m) => ({ userId: m.user.id, name: m.user.name })),
          lastActivityAt: lastActivity.get(g.id) ?? '',
        })),
        ...home.people.flatMap((p) =>
          p.directGroupId
            ? [
                {
                  id: p.directGroupId,
                  kind: 'direct' as const,
                  members: [
                    { userId: me.id, name: me.name },
                    { userId: p.user.id, name: p.user.name },
                  ],
                  lastActivityAt: '',
                },
              ]
            : [],
        ),
      ];
      // Only the names matter here; the group's own form reads the rest in its currency.
      const parsed = parseRules({
        text: sentence,
        today: localDate(),
        currency: 'XXX',
        minorUnits: 2,
        knownNames: candidates.flatMap((g) => g.members.map((m) => m.name)),
      });
      const names = [
        ...(parsed.payer.kind === 'person' ? [parsed.payer.name] : []),
        ...parsed.people,
      ];
      const groupId = chooseGroup(names, candidates, me.id);
      if (groupId === null) {
        setError('Start a group or add a friend first: expenses are always shared with someone.');
        return;
      }
      handOff(groupId, sentence);
      const friend = home.people.find((p) => p.directGroupId === groupId);
      await (friend
        ? navigate({ to: '/friends/$userId/expenses/new', params: { userId: friend.user.id } })
        : navigate({ to: '/groups/$groupId/expenses/new', params: { groupId } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
        <Sparkles aria-hidden className="size-4 shrink-0 text-primary" />
        <input
          aria-label="Type an expense"
          autoComplete="off"
          placeholder="Type it: ‘Dinner 2400 with Rahul & Amit’"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
        />
        <Button type="submit" size="sm" variant="ghost" disabled={!text.trim()} loading={busy}>
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
