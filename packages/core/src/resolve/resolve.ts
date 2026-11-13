import type { UserId } from '../types';

/** A member a typed name might mean. */
export type NameCandidate = { userId: UserId; name: string };

/** How one typed name matched (Blueprint 8.6): one person, several, or nobody. */
export type Resolution =
  | { name: string; status: 'resolved'; userId: UserId }
  | { name: string; status: 'ambiguous'; candidates: UserId[] }
  | { name: string; status: 'unknown' };

/**
 * Words that mean the person typing: English and the common Hindi/Hinglish ones (Blueprint 8.4:
 * "I/me/maine/mujhe … map to self").
 */
export const SELF_WORDS: ReadonlySet<string> = new Set([
  'i',
  'me',
  'myself',
  'maine',
  'mujhe',
  'main',
  'mai',
]);

/** Lower case, accents removed, anything but letters and digits as single spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether the typed text means the person typing. */
export function isSelf(name: string): boolean {
  return SELF_WORDS.has(normalizeName(name));
}

/**
 * Matches a typed name against members (Blueprint 8.6), in stages; the first stage with any match
 * decides:
 *
 * 1. "me", "I", "maine"… : the person typing (`meId`).
 * 2. The whole name, ignoring case and accents ("asha kapoor", "Åsha Kapoor").
 * 3. Word by word from the start, each typed word a prefix of the member's ("Rahul" → "Rahul
 *    Sharma", "rah sh" → "Rahul Sharma"), or a single word equal to any of the member's words
 *    ("Sharma").
 * 4. One typo (edit distance 1) in a name of 5 or more letters, against the whole name or any one
 *    of its words ("Rahull", "Priyaa").
 *
 * One match is resolved, several ambiguous, none unknown.
 */
export function resolveName(
  name: string,
  candidates: readonly NameCandidate[],
  meId?: UserId,
): Resolution {
  const query = normalizeName(name);
  if (meId !== undefined && SELF_WORDS.has(query))
    return { name, status: 'resolved', userId: meId };

  const people = candidates.map((c) => ({ userId: c.userId, full: normalizeName(c.name) }));
  const words = (s: string) => (s === '' ? [] : s.split(' '));
  const typed = words(query);

  const stages: ((full: string) => boolean)[] = [
    (full) => full === query,
    (full) => {
      const parts = words(full);
      if (typed.length === 0) return false;
      if (typed.length === 1 && parts.includes(typed[0]!)) return true;
      return typed.length <= parts.length && typed.every((w, i) => parts[i]!.startsWith(w));
    },
    (full) =>
      query.length >= 5 && [full, ...words(full)].some((target) => withinOneEdit(query, target)),
  ];

  for (const matches of stages) {
    const found = [...new Set(people.filter((p) => matches(p.full)).map((p) => p.userId))];
    if (found.length === 1) return { name, status: 'resolved', userId: found[0]! };
    if (found.length > 1) return { name, status: 'ambiguous', candidates: found };
  }
  return { name, status: 'unknown' };
}

/** Whether two strings differ by at most one insertion, deletion or substitution. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  // Past the first difference, the rest must line up: skipping one character of the longer
  // string (insertion or deletion), or one in each (substitution).
  return short.length === long.length
    ? short.slice(i + 1) === long.slice(i + 1)
    : short.slice(i) === long.slice(i + 1);
}
