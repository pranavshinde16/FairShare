import type { FriendDetail, FriendList, GroupBalances, Home, Money } from '@fairshare/contracts';
import { assertNetsSumToZero, simplify, type Line } from '@fairshare/core';
import { users, type Db } from '@fairshare/db';
import { eq } from 'drizzle-orm';
import { AppError } from '../../http/errors';
import * as groupsRepo from '../groups/repo';
import { notFound, toGroup, toUserRef, type Membership } from '../groups/service';
import { pairwiseBalances, toMoney } from './pairwise';
import * as repo from './repo';

export type BalancesService = ReturnType<typeof createBalancesService>;

type MyGroup = Awaited<ReturnType<typeof groupsRepo.listMyGroups>>[number];
type MemberOf = Awaited<ReturnType<typeof groupsRepo.listMembersOf>>[number];

/**
 * Balances are never stored (Blueprint 4.6): every read sums the ledger view and simplifies in
 * core. Home, the friend list and the friend page all build on the same per-group transfers, so
 * the numbers agree on every screen.
 */
export function createBalancesService(db: Db) {
  return {
    /** GET /groups/:groupId/balances. */
    async groupBalances(me: string, membership: Membership): Promise<GroupBalances> {
      const { groupId } = membership;
      const [group, members, totals] = await Promise.all([
        groupsRepo.findGroup(db, groupId),
        groupsRepo.listMembers(db, groupId),
        repo.ledgerTotals(db, groupId),
      ]);
      if (!group || group.deletedAt) throw notFound();

      // The group's currency always has an entry, so a new group lists everyone as settled.
      const currencies = [...new Set(totals.map((row) => row.currency))]
        .filter((currency) => currency !== group.currency)
        .sort();
      currencies.unshift(group.currency);

      const result: GroupBalances = {
        balances: [],
        me: { net: [], owes: [], owed: [] },
        breakdown: [],
      };
      for (const currency of currencies) {
        const sums = new Map<
          string,
          { paid: number; share: number; sent: number; received: number }
        >();
        const sumsOf = (userId: string) => {
          let entry = sums.get(userId);
          if (!entry) sums.set(userId, (entry = { paid: 0, share: 0, sent: 0, received: 0 }));
          return entry;
        };
        for (const row of totals) {
          if (row.currency !== currency) continue;
          const entry = sumsOf(row.userId);
          if (row.type === 'expense') {
            entry.paid += row.paid;
            entry.share += row.owed;
          } else {
            entry.sent += row.paid;
            entry.received += row.owed;
          }
        }
        const netOf = (userId: string) => {
          const s = sums.get(userId);
          return s ? s.paid - s.share + s.sent - s.received : 0;
        };

        // Active members in the order they joined, then anyone else who still has a balance.
        // (Nobody can leave owing or owed, so the second list is empty unless something broke.)
        const people = members.filter((m) => m.leftAt === null).map((m) => m.userId);
        const others = [...sums.keys()].filter((id) => !people.includes(id) && netOf(id) !== 0);
        people.push(...others.sort());

        const nets: Line[] = people.map((userId) => ({ userId, amount: netOf(userId) }));
        assertNetsSumToZero(nets, { groupId, currency });
        const transfers = simplify(nets);
        result.balances.push({ currency, nets, transfers });

        const mine = netOf(me);
        if (mine !== 0) result.me.net.push({ amount: mine, currency });
        for (const transfer of transfers) {
          if (transfer.from === me) result.me.owes.push({ ...transfer, currency });
          if (transfer.to === me) result.me.owed.push({ ...transfer, currency });
        }
        for (const userId of people) {
          const s = sums.get(userId) ?? { paid: 0, share: 0, sent: 0, received: 0 };
          const money = (amount: number): Money => ({ amount, currency });
          result.breakdown.push({
            userId,
            paid: money(s.paid),
            share: money(s.share),
            sent: money(s.sent),
            received: money(s.received),
          });
        }
      }
      result.me.net.sort((a, b) => a.currency.localeCompare(b.currency));
      return result;
    },

    /**
     * GET /home. The totals add up my net in each group, positives and negatives apart (Blueprint
     * 4.6), so they match the groups and friendships that make them up.
     */
    async home(me: string): Promise<Home> {
      const mine = await groupsRepo.listMyGroups(db, me);
      const ids = mine.map((g) => g.id);
      const regular = mine.filter((g) => g.kind === 'group');
      const [nets, members, activity] = await Promise.all([
        repo.netsForGroups(db, ids),
        groupsRepo.listMembersOf(db, ids),
        repo.lastActivity(
          db,
          regular.map((g) => g.id),
        ),
      ]);

      const owed = new Map<string, number>();
      const owe = new Map<string, number>();
      for (const row of nets) {
        if (row.userId !== me) continue;
        const side = row.net > 0 ? owed : owe;
        side.set(row.currency, (side.get(row.currency) ?? 0) + Math.abs(row.net));
      }
      const totals = [...new Set([...owed.keys(), ...owe.keys()])].sort().map((currency) => ({
        currency,
        owed: owed.get(currency) ?? 0,
        owe: owe.get(currency) ?? 0,
      }));

      const groups = regular.map((group) => {
        const lastActivityAt = activity.get(group.id) ?? group.createdAt;
        return {
          group: toGroup(
            group,
            members.filter((m) => m.groupId === group.id),
            me,
          ),
          myNet: myNetIn(group.id, me, nets),
          lastActivityAt: lastActivityAt.toISOString(),
        };
      });
      groups.sort(
        (a, b) =>
          Number(b.myNet.length > 0) - Number(a.myNet.length > 0) ||
          b.lastActivityAt.localeCompare(a.lastActivityAt) ||
          b.group.id.localeCompare(a.group.id),
      );

      return { totals, groups, people: friendList(me, mine, members, nets).items };
    },

    /**
     * GET /friends: the other person in each of my friendships, plus anyone else I have a non-zero
     * balance with in a shared group. Non-zero balances first, then by name.
     */
    async listFriends(me: string): Promise<FriendList> {
      const mine = await groupsRepo.listMyGroups(db, me);
      const ids = mine.map((g) => g.id);
      const [members, nets] = await Promise.all([
        groupsRepo.listMembersOf(db, ids),
        repo.netsForGroups(db, ids),
      ]);
      return friendList(me, mine, members, nets);
    },

    /**
     * GET /friends/:userId: what we owe each other in every group we're both in, and in total.
     * 404 when we share no group, so the endpoint can't be used to find out who exists.
     */
    async friend(me: string, userId: string): Promise<FriendDetail> {
      const other = userId.toLowerCase();
      const shared = other === me ? [] : await repo.sharedGroups(db, me, other);
      if (shared.length === 0) {
        throw new AppError('NOT_FOUND', 'You don’t share a group with this person.');
      }
      const [[person], nets] = await Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            avatarUrl: users.avatarUrl,
            isPlaceholder: users.isPlaceholder,
          })
          .from(users)
          .where(eq(users.id, other)),
        repo.netsForGroups(
          db,
          shared.map((g) => g.id),
        ),
      ]);

      const breakdown: FriendDetail['breakdown'] = [];
      for (const group of shared) {
        const balances = pairwiseBalances(
          me,
          nets.filter((row) => row.groupId === group.id),
        );
        const amounts = toMoney(balances.get(other));
        const groupName = group.kind === 'direct' ? null : (group.name ?? '');
        for (const balance of amounts.length > 0
          ? amounts
          : [{ amount: 0, currency: group.currency }]) {
          breakdown.push({ groupId: group.id, groupName, kind: group.kind, balance });
        }
      }
      breakdown.sort(
        (a, b) =>
          Number(b.kind === 'direct') - Number(a.kind === 'direct') ||
          Number(b.balance.amount !== 0) - Number(a.balance.amount !== 0) ||
          (a.groupName ?? '').localeCompare(b.groupName ?? '') ||
          a.groupId.localeCompare(b.groupId) ||
          a.balance.currency.localeCompare(b.balance.currency),
      );

      const total = new Map<string, number>();
      for (const { balance } of breakdown) {
        total.set(balance.currency, (total.get(balance.currency) ?? 0) + balance.amount);
      }
      return {
        user: toUserRef(person!),
        directGroupId: shared.find((g) => g.kind === 'direct')?.id ?? null,
        total: toMoney(total),
        breakdown,
      };
    },
  };
}

/** My net in one group, per currency, non-zero only. */
function myNetIn(groupId: string, me: string, nets: repo.NetRow[]): Money[] {
  return nets
    .filter((row) => row.groupId === groupId && row.userId === me)
    .map((row) => ({ amount: row.net, currency: row.currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The friend list from data the caller already has: my groups, their members and their nets. */
function friendList(
  me: string,
  mine: MyGroup[],
  members: MemberOf[],
  nets: repo.NetRow[],
): FriendList {
  const balances = pairwiseBalances(me, nets);
  const directIds = new Set(mine.filter((g) => g.kind === 'direct').map((g) => g.id));
  const people = new Map<string, MemberOf>();
  const directGroupOf = new Map<string, string>();
  for (const member of members) {
    if (member.userId === me) continue;
    people.set(member.userId, member);
    if (directIds.has(member.groupId)) directGroupOf.set(member.userId, member.groupId);
  }

  const items = [...people.values()]
    .filter(
      (person) =>
        directGroupOf.has(person.userId) || toMoney(balances.get(person.userId)).length > 0,
    )
    .map((person) => ({
      user: toUserRef({ ...person, id: person.userId }),
      balances: toMoney(balances.get(person.userId)),
      directGroupId: directGroupOf.get(person.userId) ?? null,
    }));
  items.sort(
    (a, b) =>
      Number(b.balances.length > 0) - Number(a.balances.length > 0) ||
      a.user.name.localeCompare(b.user.name) ||
      a.user.id.localeCompare(b.user.id),
  );
  return { items };
}
