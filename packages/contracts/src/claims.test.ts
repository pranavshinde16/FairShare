import { describe, expect, it } from 'vitest';
import { ClaimList, ClaimResponse } from './claims';
import { PeopleList } from './people';
import { ids, userRef } from './testing/fixtures';

describe('ClaimList', () => {
  it('accepts a placeholder in a regular and a direct group', () => {
    const list = {
      items: [
        {
          placeholder: { id: ids.c, name: 'Chitra' },
          addedBy: { name: 'Asha' },
          groups: [
            { id: ids.group, kind: 'group', name: 'Goa Trip', emoji: '🏖️' },
            { id: ids.direct, kind: 'direct', name: null, emoji: null },
          ],
        },
      ],
    };
    expect(ClaimList.parse(list)).toEqual(list);
  });

  it('rejects an unknown group kind', () => {
    const item = {
      placeholder: { id: ids.c, name: 'Chitra' },
      addedBy: { name: 'Asha' },
      groups: [{ id: ids.group, kind: 'club', name: 'X', emoji: null }],
    };
    expect(ClaimList.safeParse({ items: [item] }).success).toBe(false);
  });
});

describe('ClaimResponse and PeopleList', () => {
  it('accept their shapes', () => {
    expect(ClaimResponse.parse({ groupIds: [ids.group] })).toEqual({ groupIds: [ids.group] });
    const people = {
      items: [userRef(ids.a, 'Asha'), { ...userRef(ids.c, 'Chitra'), isPlaceholder: true }],
    };
    expect(PeopleList.parse(people)).toEqual(people);
  });
});
