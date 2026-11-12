import { z } from 'zod';
import { UserRef } from './users';

/**
 * GET /people: everyone I share an active group with, real or placeholder, sorted by name. The
 * pickers for new group members and friends offer these ("people you share a group with").
 */
export const PeopleList = z.object({ items: z.array(UserRef) });
export type PeopleList = z.infer<typeof PeopleList>;
