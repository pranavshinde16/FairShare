# Phase 10: Activity feed and history search

- **Dates:** 2026-11-12 to 2026-11-13 (code part)
- **Status:** Done. Committed as 5687999 and marked done on your go-ahead.
- **Plan reference:** Implementation blueprint §4.9 (activity and its feeds), §6.3 (activity
  endpoints), §7.2 (the Activity screen, the Expenses tab's search and filter chips), §10.4
  (search and filter combinations), §11 Phase 10, I11

## Goal

A complete audit trail, and the ability to find any past expense: the Activity tab with an unread
badge, a group's activity, and search and filter chips in the history.

## What was built

### API (`apps/api/src/modules/activity/`)

| Route                           | What it does                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| `GET /activity`                 | My feed across groups, newest first, with the unread count and `people`     |
| `GET /groups/:id/activity`      | One group's whole history, same shape; its unread count is my feed's, there |
| `POST /activity/seen`           | 204; everything up to now is read                                           |
| `GET /transactions/:id/history` | Unchanged shape, now through the same presenter                             |

- **`repo.ts`:**
  - `visible`: what my feed shows (see "Decisions").
  - `unread`: someone else's entry newer than `activity_seen_at`.
  - `feedPage` / `unreadCount`: read my membership rows first, then the log through its
    `(group_id, id)` index. Pages go by ID, newest first, with a keyset cursor.
- **`present.ts`:** entries as the API shows them.
  - Claimed placeholders shown as whoever claimed them: actor, target, and inside the snapshots
    (payers, shares, the split's input, a new owner).
  - `involvesMe`: my money before or after the change, or I'm the target. Placeholders I claimed
    count as me.
  - `people`: everyone a page's snapshots name.
- **Contracts:** `ActivityListQuery`; `ActivityFeed` gains `people` (additive).
- **API client:** `activity`, `groupActivity`, `markActivitySeen`.
- **The verbs themselves** were already recorded by every write since Phase 6 (I11); a test now
  proves each one reaches the feed.

### Web

- **Activity tab** (`/activity`):
  - Each entry is a sentence with its group and time ("Bilal added ‘Dinner’ · Goa Trip · 5 minutes
    ago").
  - What an edit changed, on a second line (at most two lines; the expense page has it in full).
  - My effect: "you borrowed ₹600.00", "you received ₹950.00".
  - Others' changes that involve me stand out.
  - A row opens the expense, the group, or for a new friendship the friend's page. Nothing opens
    for a deleted group or one I was removed from.
  - Pages load as you scroll. Empty: "Changes in your groups will appear here."
- **Unread badge** on Activity, in the sidebar and the phone tab bar.
  - Others' changes since I last looked; screen readers hear "Activity (3 unread)".
  - Checked every minute while the app is open and on returning to the window.
  - Opening Activity marks everything read (and again if more arrives while it's open).
- **History search and filter chips** (Expenses tab, also on the friend page):
  - Search; Person; Expenses / Payments; Dates (with "This month" and "Last month"); Show deleted.
  - "Clear", and "Clear filters" when nothing matches.
  - On a group's page the filters are in the URL, so a reload, or opening an expense and coming
    back, keeps them.
- **Restore from the list:** with "Show deleted", deleted rows have a Restore button.
- **Sentences shared** (`features/expenses/history.ts` → `describeChanges`): the feed and the
  expense page say the same thing about an edit.

## Decisions and deviations

- **My feed starts when I joined a group.** Otherwise joining an old group would put its whole
  history in the badge.
  - A group's own feed (`/groups/:id/activity`) has everything, as its audit trail.
  - A claimed placeholder keeps its original join date, so whoever claims it sees what happened
    to "them".
- **A deleted group leaves only its "deleted" entry** in its members' feeds.
- **Someone removed from a group sees only that** ("Asha removed you"), not the group's later
  activity.
- **A friendship's `group.created` entry is left out of feeds.** "Asha added you as a friend"
  says the same, and two entries for one action would count twice in the badge.
- **Unread belongs to the entry:** a group feed's `unreadCount` is my feed's count narrowed to that
  group, so the numbers can never disagree.
- **Placeholders in old entries are shown as whoever claimed them.** The log is append-only
  (Phase 3), so it keeps the placeholder's ID; readers resolve it. The plan corrections table had
  this down for Phase 10. It now covers the snapshots too, so an old expense names the real person
  in the feed and in the expense's history.
- **The feed response carries `people`** (an additive contract change), so sentences can name
  everyone in a snapshot without the web loading every group.
- **Seen is a time, as the plan says** (`activity_seen_at = now()`). A change committed in the
  milliseconds around opening Activity, whose transaction started just before, would count as
  read. A watermark on IDs has the same gap. This is noted, not fixed.
- **The group's activity has no screen yet:** the plan's Phase 10 web tasks don't include one; the
  endpoint is there for it.
- **Modal routes now close with Back** (`lib/modal-route.ts`). Closing used to push a new history
  entry, so after saving an edit, Back reopened the editor, and reaching the filtered list took
  three Backs. A page that opens its own modal (Add expense, Settle, Edit) now marks it, and
  closing goes Back to it. A modal reached any other way (the Home picker, a link, a reload)
  replaces itself with its page. Found by this phase's "find an old expense and edit it" journey.
- **Deleted rows show no effect** ("you lent ₹225.00" on a deleted expense was misleading); the row
  says "deleted" and offers Restore.

## Problems found and fixed

1. **Back reopened a closed dialog** (see "Modal routes now close with Back").
2. **The badge read "2 unread Activity" on phones** but "Activity 2 unread" on desktop, because
   of where it sat. The number is now for the eye only, and the spoken text comes after the label
   on both.
3. **Activity rows on phones squeezed an edit's detail** into a narrow column beside the effect.
   On phones the effect now sits under the sentence, and the detail is at most two lines.
4. **The database package's integration tests timed out** (10 s) when every package's tests ran
   at once. Each test file clones and later drops its own database, and Postgres checkpoints for
   every `DROP DATABASE`, so they queue. Phase 6 had raised `apps/api`'s limits to 20 s for this;
   `packages/db` had kept the default, and the API suites added since tipped it over. Same limits
   now. Three full forced runs since: all green.
5. **An end-to-end test's "People" heading matched twice on desktop** (the sidebar's and the main
   column's), depending on which rendered first. It's scoped to the main column now, like the
   others since Phase 8.
6. **Not reproduced:** one core test failed once in a full forced run under the timeouts above; its
   name wasn't captured. Not seen again in 3 full runs and 40 core runs (40,000 random cases per
   property). The slowest core test takes 446 ms with coverage, against a 5 s limit.
7. **Environment:** Playwright's Chromium disappeared from `~/.cache/ms-playwright` overnight (not
   by anything in this repo) and was reinstalled. The first run afterwards had two sign-ins that
   didn't reach Home within 5 s; that didn't recur in the next four runs.
8. **Leftover test databases:** interrupted runs left 23 throwaway `fairshare_test_*` databases;
   they're dropped.

## Verification

- `pnpm check` passes, and `pnpm test --force` three times in a row.

  | Package    | Tests     |
  | ---------- | --------- |
  | core       | 251       |
  | contracts  | 286       |
  | api-client | 63        |
  | db         | 97        |
  | api        | 321       |
  | web        | 86        |
  | **Total**  | **1,104** |

- **Activity integration tests (11):**
  - every verb, in order, in the group's feed: group created, renamed, updated, deleted; members
    added, removed, left, claimed; invites created and revoked; expenses and payments created,
    edited, deleted and restored
  - after deletion, only the "deleted" entry remains in members' feeds
  - my feed from when I joined; a group's feed in full; nothing from others' groups
  - paging without gaps or repeats while entries arrive; bad cursors and limits refused
  - unread: others' entries only, reset by "seen", the same in a group's feed
  - a claimed placeholder resolved in the feed, `people` and the expense's history
  - `involvesMe` before and after an edit, and as the target
  - removal, friendships, access (401, 404)
- **List filters:** type, person, dates and deleted together, a page at a time.
- **Bug injection: 18 of 18 caught:**
  - the join date ignored; deleted groups shown whole; friendship creation shown; removal not
    shown
  - own entries counted unread; the seen time ignored; "seen" doing nothing
  - placeholders not resolved; `involvesMe` ignoring the "before"; the cursor repeating an
    entry; a group's feed not scoped
  - (web) the effect's sign flipped; a friendship row linking to me; the type filter dropped;
    relative days off by one
  - (end-to-end) Activity not marked read on visiting; modal close never going Back; filters not
    kept in the URL
- **End-to-end: 44 of 44, three times in a row** (22 tests × desktop and phone), no console errors.
  New:
  - a second person joins and adds an expense: Asha's badge shows 2, the feed reads them with
    her effect, the badge clears, an edit brings it back with what changed, a row opens the
    expense
  - finding an old expense by search, person and dates; the filters surviving a reload; editing
    it and one Back to the filtered list; payments only; Clear; Show deleted and Restore
- **Docker image:** migrations run (twice, idempotent), the smoke test passes, the three new
  routes answer 401 without a session, no error logs.
- **Screenshots reviewed:** the badge on desktop and phone, the Activity tab on a phone, the
  filter chips and the dates dialog, a deleted row with Restore.

## Lined up next

**To finish Phase 10:**

1. **Commit and push** (nothing is committed). There are no new settings and no migrations.
2. **Check on staging** with two accounts:
   - With one, add or edit an expense in a shared group; with the other, see the badge, open
     Activity, and see it clear.
   - In a group's Expenses, search and use the chips; open an expense and come back: the filters
     stay.
   - Show deleted, and Restore one.

**Phase 11: advanced splits** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 11:** the edit form's split sheet; the history sentences already describe exact, percent
  and shares changes.
- **v1.1:** a group activity screen on `GET /groups/:id/activity`; a "new" marker on rows unread at
  the time of the visit.
- **Phase 14:** the 114 kB shared chunk noted in Phase 7.
