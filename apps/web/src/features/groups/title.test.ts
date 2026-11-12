import { describe, expect, it } from 'vitest';
import { groupTitle } from './title';

const member = (id: string, name: string) => ({
  user: { id, name, avatarUrl: null, isPlaceholder: false },
  role: 'member' as const,
  joinedAt: '2026-11-01T00:00:00.000Z',
  leftAt: null,
});

describe('groupTitle', () => {
  it('uses a regular group’s name', () => {
    expect(groupTitle({ kind: 'group', name: 'Goa Trip', members: [] }, 'me')).toBe('Goa Trip');
  });

  it('names a friendship after the other person', () => {
    const members = [member('me', 'Asha'), member('b', 'Bilal')];
    expect(groupTitle({ kind: 'direct', name: null, members }, 'me')).toBe('You & Bilal');
    expect(groupTitle({ kind: 'direct', name: null, members }, 'b')).toBe('You & Asha');
  });
});
