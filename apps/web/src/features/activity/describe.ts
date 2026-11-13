import type { ActivityEntry, UserRef } from '@fairshare/contracts';
import { describeChanges, isSettlement } from '../expenses/history';
import { paymentSentence } from '../settlements/payment';

/** How a feed row reads and where it leads. */
export type ActivityLine = {
  /** "Asha added ‘Dinner’", "You recorded a payment". */
  text: string;
  /** A second line: what an edit changed, or who paid whom. */
  detail: string | null;
  /** This change's effect on me, for a transaction: "you borrowed ₹400.00". */
  effect: { text: string; tone: 'owed' | 'owes' | 'neutral' } | null;
  link:
    | { to: '/transactions/$id'; params: { id: string } }
    | { to: '/groups/$groupId'; params: { groupId: string } }
    | { to: '/friends/$userId'; params: { userId: string } }
    | null;
};

export type DescribeContext = {
  meId: string;
  /** People the feed page names (its `people`). */
  people: readonly UserRef[];
  money: (amount: number, currency: string) => string;
};

type Snapshot = {
  description?: string;
  amount?: number;
  currency?: string;
  payers?: { userId: string; amount: number }[];
  shares?: { userId: string; amount: number }[];
  name?: string | null;
  emoji?: string | null;
  placeholderName?: string;
  newOwnerId?: string;
  inviteId?: string;
};

/**
 * One activity entry as a feed row (Blueprint 7.2: "Rahul added ‘Dinner’ in Goa Trip", with my
 * effect; tapping opens the entity). The group's name is shown beside the sentence, not in it.
 */
export function describeActivity(entry: ActivityEntry, ctx: DescribeContext): ActivityLine {
  const { meId } = ctx;
  const known = new Map<string, UserRef>(ctx.people.map((p) => [p.id, p]));
  known.set(entry.actor.id, entry.actor);
  if (entry.target) known.set(entry.target.id, entry.target);
  /** A person mid-sentence: "you" for me. */
  const name = (userId: string) =>
    userId === meId ? 'you' : (known.get(userId)?.name ?? 'someone');
  const actor = entry.actor.id === meId ? 'You' : entry.actor.name;
  const target = entry.target && name(entry.target.id);
  const before = (entry.before ?? {}) as Snapshot;
  const after = (entry.after ?? {}) as Snapshot;
  const direct = entry.groupName === null;
  const toGroup = { to: '/groups/$groupId' as const, params: { groupId: entry.groupId } };
  const line = (text: string, rest: Partial<ActivityLine> = {}): ActivityLine => ({
    text,
    detail: null,
    effect: null,
    link: toGroup,
    ...rest,
  });

  switch (entry.verb) {
    case 'transaction.created':
    case 'transaction.updated':
    case 'transaction.deleted':
    case 'transaction.restored': {
      const settlement = isSettlement(entry.after) || isSettlement(entry.before);
      const s = entry.verb === 'transaction.deleted' ? before : after;
      const currency = s.currency ?? '';
      const money = (amount: number) => ctx.money(amount, currency);
      const what = settlement ? 'a payment' : `‘${s.description ?? ''}’`;
      const verb = {
        'transaction.created': settlement ? 'recorded' : 'added',
        'transaction.updated': 'edited',
        'transaction.deleted': 'deleted',
        'transaction.restored': 'restored',
      }[entry.verb];
      const paid = settlement && s.payers?.[0] && s.shares?.[0];
      const who = paid
        ? `${capitalize(paymentSentence(s.payers![0]!.userId, s.shares![0]!.userId, meId, name))} ${money(s.amount ?? 0)}`
        : null;
      const detail =
        entry.verb === 'transaction.updated'
          ? (describeChanges(entry.before, entry.after, name, money) ?? who)
          : who;
      return line(`${actor} ${verb} ${what}`, {
        detail: detail && capitalize(detail),
        effect: entry.verb === 'transaction.deleted' ? null : effectOn(s, meId, settlement, money),
        link: { to: '/transactions/$id', params: { id: entry.entityId } },
      });
    }

    case 'group.created':
      return line(`${actor} created the group`);
    case 'group.renamed':
      return line(`${actor} renamed the group to ‘${after.name ?? ''}’`);
    case 'group.updated': {
      const parts = [
        ...('emoji' in after ? [`the emoji to ${after.emoji ?? 'none'}`] : []),
        ...('currency' in after ? [`the currency to ${after.currency ?? ''}`] : []),
      ];
      return line(`${actor} changed ${parts.length ? parts.join(' and ') : 'the group'}`);
    }
    case 'group.deleted':
      return line(`${actor} deleted the group ‘${before.name ?? ''}’`, { link: null });

    case 'member.added': {
      if (direct) {
        // A friendship starts with this entry: the friend is whichever of the two isn't me.
        const friend = entry.target && entry.target.id !== meId ? entry.target.id : entry.actor.id;
        const link =
          friend !== meId ? { to: '/friends/$userId' as const, params: { userId: friend } } : null;
        return line(
          entry.target?.id === meId
            ? `${actor} added you as a friend`
            : `${actor} added ${target ?? 'someone'} as a friend`,
          { link },
        );
      }
      if (entry.target?.id === entry.actor.id) {
        return line(`${actor} joined${after.inviteId ? ' with an invite link' : ''}`);
      }
      return line(`${actor} added ${target ?? 'someone'}`);
    }
    case 'member.removed':
      return line(`${actor} removed ${target ?? 'someone'}`, {
        // I can't open a group I was removed from.
        link: entry.target?.id === meId ? null : toGroup,
      });
    case 'member.left':
      return line(`${actor} left the group`, {
        detail: after.newOwnerId
          ? `${capitalize(name(after.newOwnerId))} ${after.newOwnerId === meId ? 'are' : 'is'} now the owner`
          : null,
        link: entry.actor.id === meId ? null : toGroup,
      });
    case 'member.claimed':
      return line(`${actor} joined as ${after.placeholderName ?? 'a placeholder'}`);

    case 'invite.created':
      return line(target ? `${actor} invited ${target}` : `${actor} created an invite link`);
    case 'invite.revoked':
      return line(
        target
          ? `${actor} turned off ${target}’s invite link`
          : `${actor} turned off an invite link`,
      );
  }
}

/** My effect from a transaction's snapshot: what I paid minus my share. */
function effectOn(
  s: Snapshot,
  meId: string,
  settlement: boolean,
  money: (amount: number) => string,
): ActivityLine['effect'] {
  const sum = (lines: Snapshot['payers']) =>
    (lines ?? []).filter((l) => l.userId === meId).reduce((total, l) => total + l.amount, 0);
  const net = sum(s.payers) - sum(s.shares);
  if (net === 0) return null;
  if (settlement) {
    return {
      text: net > 0 ? `you paid ${money(net)}` : `you received ${money(-net)}`,
      tone: 'neutral',
    };
  }
  return net > 0
    ? { text: `you lent ${money(net)}`, tone: 'owed' }
    : { text: `you borrowed ${money(-net)}`, tone: 'owes' };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
