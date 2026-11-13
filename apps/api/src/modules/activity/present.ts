import type { ActivityEntry, UserRef } from '@fairshare/contracts';
import type { Db } from '@fairshare/db';
import * as transactionsRepo from '../transactions/repo';
import type { ActivityRow } from './repo';
import { claimedPlaceholders, unreadAmong } from './repo';

type Snapshot = Record<string, unknown>;
type Resolve = (userId: string) => string;

/**
 * Log entries as the API shows them (Blueprint 4.9). The log is append-only, so entries written
 * before a placeholder was claimed still name the placeholder; here every person, in the actor,
 * the target and inside the before/after snapshots, is shown as whoever claimed them.
 *
 * involvesMe: I paid or have a share in the transaction (before or after the change), or I'm the
 * person the entry is about. Placeholders I claimed count as me.
 *
 * unread: someone else's change since I last opened Activity, the same wherever it's shown.
 */
export async function presentEntries(
  db: Db,
  rows: ActivityRow[],
  me: string,
): Promise<{ items: ActivityEntry[]; people: UserRef[] }> {
  const named = rows.flatMap((r) => [...idsIn(r.before), ...idsIn(r.after)]);
  const [people, mine, unread] = await Promise.all([
    transactionsRepo.people(db, [
      ...rows.flatMap((r) => [r.actorId, ...(r.targetUser ? [r.targetUser] : [])]),
      ...named,
    ]),
    claimedPlaceholders(db, me),
    unreadAmong(
      db,
      me,
      rows.map((r) => r.id),
    ),
  ]);
  const resolve: Resolve = (id) => people.get(id)?.id ?? id;
  const myIds = new Set([me, ...mine]);

  const items = rows.map((row): ActivityEntry => {
    const before = resolveSnapshot(row.before, resolve);
    const after = resolveSnapshot(row.after, resolve);
    const target = row.targetUser ? toUserRef(people.get(row.targetUser)!) : null;
    return {
      id: row.id,
      groupId: row.groupId,
      groupName: row.groupKind === 'direct' ? null : row.groupName,
      actor: toUserRef(people.get(row.actorId)!),
      verb: row.verb as ActivityEntry['verb'],
      entityType: row.entityType,
      entityId: row.entityId,
      target,
      before,
      after,
      createdAt: row.createdAt.toISOString(),
      involvesMe:
        (row.targetUser !== null && myIds.has(row.targetUser)) ||
        [...idsIn(row.before, 'lines'), ...idsIn(row.after, 'lines')].some((id) => myIds.has(id)),
      unread: unread.has(row.id),
    };
  });

  const seen = new Set<string>();
  const mentioned: UserRef[] = [];
  for (const id of named) {
    const person = people.get(id);
    if (person && !seen.has(person.id)) {
      seen.add(person.id);
      mentioned.push(toUserRef(person));
    }
  }
  return { items, people: mentioned };
}

const isObject = (value: unknown): value is Snapshot =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const lineIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((l) => (isObject(l) && typeof l.userId === 'string' ? [l.userId] : []))
    : [];

/**
 * The people a snapshot names. 'lines': only payers and shares (who the money involves).
 * 'all': also the split's input (which can list someone with a zero share) and a new owner.
 */
export function idsIn(snapshot: unknown, which: 'lines' | 'all' = 'all'): string[] {
  if (!isObject(snapshot)) return [];
  const ids = [...lineIds(snapshot.payers), ...lineIds(snapshot.shares)];
  if (which === 'lines') return ids;
  const split = snapshot.splitInput;
  if (isObject(split)) {
    if (Array.isArray(split.participants)) {
      ids.push(...split.participants.filter((p): p is string => typeof p === 'string'));
    }
    ids.push(...lineIds(split.amounts), ...lineIds(split.basisPoints), ...lineIds(split.shares));
  }
  if (typeof snapshot.newOwnerId === 'string') ids.push(snapshot.newOwnerId);
  return ids;
}

/** A snapshot with every person in it resolved; anything else in it is kept as it is. */
export function resolveSnapshot(snapshot: unknown, resolve: Resolve): Snapshot | null {
  if (!isObject(snapshot)) return null;
  const lines = (value: unknown): unknown =>
    Array.isArray(value)
      ? (value as unknown[]).map((l) =>
          isObject(l) && typeof l.userId === 'string' ? { ...l, userId: resolve(l.userId) } : l,
        )
      : value;
  const result: Snapshot = { ...snapshot };
  if ('payers' in result) result.payers = lines(result.payers);
  if ('shares' in result) result.shares = lines(result.shares);
  if (isObject(result.splitInput)) {
    const split: Snapshot = { ...result.splitInput };
    if (Array.isArray(split.participants)) {
      split.participants = (split.participants as unknown[]).map((p) =>
        typeof p === 'string' ? resolve(p) : p,
      );
    }
    for (const key of ['amounts', 'basisPoints', 'shares']) {
      if (key in split) split[key] = lines(split[key]);
    }
    result.splitInput = split;
  }
  if (typeof result.newOwnerId === 'string') result.newOwnerId = resolve(result.newOwnerId);
  return result;
}

const toUserRef = (p: transactionsRepo.PersonRow): UserRef => ({
  id: p.id,
  name: p.name,
  avatarUrl: p.avatarUrl,
  isPlaceholder: p.isPlaceholder,
  isDeleted: p.isDeleted,
});
