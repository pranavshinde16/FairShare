import { describe, expect, it } from 'vitest';
import { chooseGroup, type GroupCandidate } from './groups';
import { isSelf, normalizeName, resolveName, withinOneEdit } from './resolve';

const ME = 'u-me';
const members = [
  { userId: ME, name: 'Pranav Shinde' },
  { userId: 'u-rs', name: 'Rahul Sharma' },
  { userId: 'u-rk', name: 'Rahul Kumar' },
  { userId: 'u-amit', name: 'Amit' },
  { userId: 'u-priya', name: 'Priya Iyer' },
  { userId: 'u-zoe', name: 'Zoë Fernandes' },
];
const resolve = (name: string) => resolveName(name, members, ME);

describe('resolveName (Blueprint 8.6)', () => {
  it.each([
    // exact, ignoring case and accents
    ['Amit', 'u-amit'],
    ['rahul sharma', 'u-rs'],
    ['  RAHUL   KUMAR ', 'u-rk'],
    ['Zoe Fernandes', 'u-zoe'],
    ['zoë', 'u-zoe'],
    // first name, prefix, last name
    ['Priya', 'u-priya'],
    ['pri', 'u-priya'],
    ['Rahul S', 'u-rs'],
    ['rah ku', 'u-rk'],
    ['Sharma', 'u-rs'],
    ['Iyer', 'u-priya'],
    // one typo, 5+ letters
    ['Priyaa', 'u-priya'],
    ['Rahul Shrma', 'u-rs'],
    ['Fernandez', 'u-zoe'],
    ['Ami t', 'u-amit'],
    // the person typing
    ['me', ME],
    ['I', ME],
    ['maine', ME],
    ['Mujhe', ME],
    ['Pranav', ME],
  ])('%j → %s', (name, userId) => {
    expect(resolve(name)).toEqual({ name, status: 'resolved', userId });
  });

  it('is ambiguous when the best stage matches several people', () => {
    expect(resolve('Rahul')).toEqual({
      name: 'Rahul',
      status: 'ambiguous',
      candidates: ['u-rs', 'u-rk'],
    });
    expect(resolve('r')).toMatchObject({ status: 'ambiguous', candidates: ['u-rs', 'u-rk'] });
  });

  it('prefers an exact match over prefixes, and prefixes over typos', () => {
    const people = [
      { userId: 'a', name: 'Ana' },
      { userId: 'b', name: 'Anaya' },
      { userId: 'c', name: 'Karan' },
      { userId: 'd', name: 'Karen' },
    ];
    expect(resolveName('Ana', people)).toMatchObject({ status: 'resolved', userId: 'a' });
    expect(resolveName('Anay', people)).toMatchObject({ status: 'resolved', userId: 'b' });
    // "Karan" is exact even though "Karen" is one letter away.
    expect(resolveName('Karan', people)).toMatchObject({ status: 'resolved', userId: 'c' });
    // One letter away from both: ambiguous.
    expect(resolveName('Karin', people)).toMatchObject({
      status: 'ambiguous',
      candidates: ['c', 'd'],
    });
  });

  it.each(['Amitabh', 'Rohan', 'Amt', 'Prya', '', '!!!'])('%j is unknown', (name) => {
    // Typos only from 5 letters: "Amt" and "Prya" are too short to guess.
    expect(resolve(name)).toEqual({ name, status: 'unknown' });
  });

  it('treats "me" as a name when nobody is typing (no meId)', () => {
    expect(resolveName('me', members)).toEqual({ name: 'me', status: 'unknown' });
  });

  it('counts one person once, however many ways a name matches them', () => {
    const twice = [
      { userId: 'x', name: 'Asha Asha' },
      { userId: 'y', name: 'Bilal' },
    ];
    expect(resolveName('Asha', twice)).toEqual({ name: 'Asha', status: 'resolved', userId: 'x' });
  });
});

describe('helpers', () => {
  it('normalizes names', () => {
    expect(normalizeName('  Zoë-Anne  O’Brien ')).toBe('zoe anne o brien');
    expect(normalizeName('ÅSHA')).toBe('asha');
  });

  it('knows the words for the person typing', () => {
    expect(['I', 'me', 'Myself', 'maine', 'mujhe', 'main', 'mai'].every(isSelf)).toBe(true);
    expect(isSelf('Rahul')).toBe(false);
  });

  it.each([
    ['rahul', 'rahul', true],
    ['rahul', 'rahull', true],
    ['rahull', 'rahul', true],
    ['rahul', 'rahol', true],
    ['rahul', 'arhul', false], // a swap is two edits
    ['rahul', 'rah', false],
    ['rahul', 'rohan', false],
    ['', 'a', true],
  ])('withinOneEdit(%j, %j) = %s', (a, b, expected) => {
    expect(withinOneEdit(a, b)).toBe(expected);
  });
});

describe('chooseGroup (Blueprint 8.6 "Group selection")', () => {
  const m = (userId: string, name: string) => ({ userId, name });
  const me = m(ME, 'Pranav');
  const goa: GroupCandidate = {
    id: 'goa',
    kind: 'group',
    members: [me, m('u-rs', 'Rahul Sharma'), m('u-amit', 'Amit'), m('u-c', 'Chitra')],
    lastActivityAt: '2026-11-10T10:00:00Z',
  };
  const flat: GroupCandidate = {
    id: 'flat',
    kind: 'group',
    members: [me, m('u-amit', 'Amit'), m('u-d', 'Dev')],
    lastActivityAt: '2026-11-12T10:00:00Z',
  };
  const withAmit: GroupCandidate = {
    id: 'amit',
    kind: 'direct',
    members: [me, m('u-amit', 'Amit')],
    lastActivityAt: '2026-11-13T10:00:00Z',
  };
  const all = [goa, flat, withAmit];

  it('picks the group where the most names resolve', () => {
    expect(chooseGroup(['Rahul', 'Amit'], all, ME)).toBe('goa');
    expect(chooseGroup(['Amit', 'Dev'], all, ME)).toBe('flat');
  });

  it('prefers the friendship when one other person is named', () => {
    expect(chooseGroup(['Amit'], all, ME)).toBe('amit');
    expect(chooseGroup(['me', 'Amit'], all, ME)).toBe('amit');
    // Even when the friendship has been quiet the longest.
    const quiet = { ...withAmit, lastActivityAt: '2026-01-01T00:00:00Z' };
    expect(chooseGroup(['Amit'], [goa, flat, quiet], ME)).toBe('amit');
    // No friendship with Chitra: her group.
    expect(chooseGroup(['Chitra'], all, ME)).toBe('goa');
  });

  it('breaks ties by latest activity, then by ID', () => {
    expect(chooseGroup(['Zara'], [goa, flat], ME)).toBe('flat');
    const twin = { ...flat, id: 'aaa' };
    expect(chooseGroup(['Zara'], [flat, twin], ME)).toBe('aaa');
    expect(chooseGroup(['Zara'], [twin, flat], ME)).toBe('aaa');
  });

  it('with nobody named, goes to the latest regular group', () => {
    expect(chooseGroup([], all, ME)).toBe('flat');
    expect(chooseGroup(['me'], [withAmit, goa], ME)).toBe('goa');
    expect(chooseGroup([], [withAmit], ME)).toBe('amit');
  });

  it('is null without any group', () => {
    expect(chooseGroup(['Amit'], [], ME)).toBeNull();
  });

  it('does not count a name that only matches the person typing', () => {
    // "Pranav" is me: no group earns a point for it.
    expect(chooseGroup(['Pranav'], [goa, flat], ME)).toBe('flat');
  });
});
