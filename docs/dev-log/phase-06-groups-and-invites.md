# Phase 6: Groups, members, friends and invites

- **Dates:** 2026-11-12 (code part)
- **Status:** In progress. The code is done and verified locally (integration tests including the
  authorization matrix, end-to-end tests, the Docker image). It goes live with the next push; then
  check it on staging (see "Lined up next").
- **Plan reference:** Implementation blueprint §4.2 (groups and members), §4.3 (friends), §4.9
  (activity), §5.2 (tables), §5.3 (claim/merge), §6.3 (endpoints), §7.2 (screens), §9.1
  (authorization), §11 Phase 6; seven plan corrections scheduled for Phase 6

## Goal

Groups and one-to-one friendships, with placeholders for people who haven't joined; invite links;
claiming a placeholder (a merge); and on the web: creating a group, the group's Members tab,
adding people, sharing invites, the invite page and a friends list. Outcome: groups and
friendships with placeholders, invites and claiming all work.

## What was built

### API (`apps/api/src/modules/`)

| Module      | Routes                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `groups/`   | `POST`/`GET /groups`; `GET`/`PATCH`/`DELETE /groups/:id`; `POST /groups/:id/members`; `DELETE /groups/:id/members/:userId` (`me` to leave) |
| `invites/`  | `POST`/`DELETE /groups/:id/invites[/:inviteId]`; public `GET /invites/:token`; `POST /invites/:token/accept`                               |
| `friends/`  | `POST`/`GET /friends`; `GET /people`                                                                                                       |
| `claims/`   | `GET /claims`; `POST`/`DELETE /claims/:placeholderId`; `merge.ts`, the claim procedure                                                     |
| `balances/` | `netsForGroups` (the ledger view, non-zero nets) and `pairwiseBalances` (friend balances through core's `simplify`)                        |
| `activity/` | `recordActivity(tx, …)`: every write's history, in the same transaction                                                                    |

Supporting pieces:

- **`groups/membership.ts`:** `requireMembership`, the one authorization check for group routes.
- **`groups/policies.ts`:** pure permission rules (owner-only actions, settled balances, the next
  owner, editable kinds) with unit tests.
- **`http/client-ip.ts`:** the client IP for the invite preview's limit (30 a minute per IP).
- **Contracts:** `PeopleList`, `ClaimList` / `Claimable` / `ClaimResponse`, error code
  `NOT_PERMITTED` (403). The API client got a method for every new endpoint.

### Web (`apps/web/src/`)

- **Home:**
  - Placeholders made with my email ("Asha added you to Goa Trip as ‘Bilal’. Is that you?"),
    with "That's me" and "Not me".
  - My groups with my balance in each, and my people with what we owe each other, in words as
    well as colour.
  - When both are empty, the plan's three cards: start a group, add a friend, paste an invite
    link.
- **Sidebar:** real Groups and People lists, and "New group".
- **`/groups/new`:** group name, emoji, currency (defaults to the profile's), and people as chips,
  from "People you know" or new names with an optional email. A warning appears for duplicate
  names. The group's ID is made in the browser (UUIDv7), so a retry can't create it twice.
- **`/groups/$groupId`:**
  - Header: emoji, title ("You & Bilal" for a friendship), member count, currency, settings.
  - Tabs as a search parameter: Expenses and Balances show empty states until Phases 7–8;
    Members is real.
  - Members tab: owner and "Not joined yet" labels, "Invite Bilal" (a link aimed at that
    placeholder), Remove (owner), Leave, Add person, and former members.
  - Settings dialog: name, emoji, currency, and Delete for the owner.
  - After creating a group, a banner prompts sharing the invite.
- **`/invite/$token`** (public):
  - Shows who invited you to what, before signing in.
  - Sign-in returns to the page.
  - Then "I'm Bilal" (preselected when the link was aimed at Bilal) or "I'm not listed: join as
    myself". A friendship link offers only its friend.
  - Expired, used and broken links each get their own message.
- **Sharing:** the system share sheet (WhatsApp on phones), or the link copied where there's none.
- **Dialogs:** the browser's own `<dialog>` (focus trap, Esc, inert background), shaped as a bottom
  sheet on phones. Not Radix: its scroll lock injects a `<style>` element, which the CSP blocks.
- **Browser error reports** have invite tokens cut out of every string (`lib/redact.ts`), as the
  server logs already did.

### Tests and CI

- **Integration tests:** groups, members, leaving, the authorization matrix, invites, the merge,
  friends, people, claims.
- **End-to-end:**
  - Create a group with a placeholder, invite them, and have the second person (a separate
    browser context) sign up through the link and claim their place.
  - Add a friend.
  - Leave a group.
- **Smoke test:** one new check, that an unknown invite link answers 404.

## Decisions and deviations

You reviewed and confirmed four of these on 2026-11-12: adding by email makes a placeholder and
offers a claim; real balance checks now; the friendship rules; and closing a group when its last
member with an account leaves.

- **Adding by email never links an existing account.** The plan adds the matching account
  directly and says the response looks the same either way. It can't stay the same: the group
  then shows the real person's name and picture, which reveals the account, and they'd be in the
  group without being asked. Instead, an email is always a hint on a new placeholder, and the
  person with that address is offered to claim it (`GET /claims`, from the plan correction about
  hinted emails). It's the same merge as an invite claim, so there's still one code path (C8).
- **Real balance checks now, not a stub.** The plan stubs "balance is zero" until Phase 8. But the
  ledger view exists and the demo seed has expenses, so remove, leave and delete check real nets
  from the start. Phase 8's "wire the real checks" item is already done.
- **`GET /friends` returns real balances.** In each group and currency, core's `simplify` turns
  the nets into transfers, and the ones between me and each person add up. Phase 8 adds
  `/home`, `GET /friends/:userId` and the friend page on top.
- **Endpoints the plan doesn't list:** `GET /people` (the "people you know" picker; `/friends`
  leaves out settled co-members) and the three `/claims` routes. New error code `NOT_PERMITTED`
  (403) for owner-only actions.
- **`POST /groups` replays:** the same ID from the same creator returns the group (200); another
  person's ID is `ID_CONFLICT`. The plan had only the conflict.
- **Seniority:** someone brought back after leaving gets a new `joined_at`, which decides the next
  owner.
- **When the last member with an account leaves, the group closes** (the plan correction's "no
  real member" case). Nobody could open it any more.
- **Friendships:**
  - They have no owner; both members are plain members.
  - They can't be renamed, left, deleted or given more members.
  - They take only an invite aimed at the placeholder friend.
  - Their currency is the creator's default currency.
- **Invites aimed at a claimed placeholder are left as they are,** instead of being repointed to
  the claimer as the plan says. The preview simply stops offering that placeholder.
- **A claimed friendship that merges into one the claimer already had** returns that friendship's
  ID, since the placeholder's own one closes. The moved expenses keep their currency; the ledger
  is per currency, so balances stay right.
- **`/groups/new` is a page, not a modal.** Dialogs (add person, add friend, settings, confirm)
  use the native `<dialog>`.
- **People without a friendship aren't links yet,** because the friend page arrives in Phase 8.
- **Activity entries:**
  - Member entries use the person's ID as `entityId`.
  - `member.claimed` targets the placeholder, with its name in `after`.
  - `member.left` records the new owner, if any.
  - Nothing is written when an update changes nothing.

## Problems found and fixed

1. **A deadlock between two claims.** Bug injection showed the "two people claim one placeholder"
   test passed even without the placeholder lock. Accepting an invite also locks the group row,
   so claims through the same invite queued on that. A new test claims the same placeholder
   through two groups' invites at once, and it found a real deadlock, which surfaced as a 500:
   - Each claim held `FOR UPDATE` on its own group's row.
   - The first then wrote activity in the other group, and that write's foreign-key check needs a
     share lock on the other group's row, which `FOR UPDATE` blocks.

   Every row lock is now `FOR NO KEY UPDATE`. That still queues writers on the same row, but
   doesn't block foreign-key checks. The test passes 5 of 5 runs, and fails 3 of 3 with the lock
   removed.

2. **Accepting a friendship claim could return a closed group** (found while planning the merge
   tests). The merge now reports which friendship replaced which.
3. **Two fields labelled "Name"** on the new-group page (the group's and the person's). Playwright
   refused to guess which was meant, and neither could a screen reader. The first is now
   "Group name".
4. **Member rows on phones** squeezed "Not joined yet" into a narrow column beside two buttons
   (seen in the screenshot review). The actions now take their own line below 640px.
5. **The API client's 100% coverage gate** failed until every new method had a test.
6. **CI failed after the push (commit f099be3) on an ordering bug.**
   - What failed: an invite test took the second member to be Bilal. Placeholders created in one
     request share a `joined_at` and got their IDs in the same millisecond, and the ID's random
     tail decided their order.
   - What users would see: people added together could be listed in any order.
   - The fix: the server's UUIDv7s now use a 12-bit counter within a millisecond (RFC 9562
     "method 1"), so they only ever increase within a process, and people show in the order
     they were added.
   - A new test adds 20 people in reverse-alphabetical order and expects that order back. It fails
     3 of 3 runs with the old random IDs.
   - The invite test now finds members by name.
7. **Tests timed out under load.** Two tests that create an extra database timed out at Vitest's
   default 5 seconds when every package's tests ran at once. The API's tests now allow 20 seconds.
8. **The Playwright browser was missing:** `~/.cache/ms-playwright` had been removed outside this
   session. It was reinstalled.

## Verification

- `pnpm check` passes.

  | Package    | Tests   |
  | ---------- | ------- |
  | core       | 247     |
  | contracts  | 283     |
  | api-client | 48      |
  | db         | 97      |
  | api        | 249     |
  | web        | 18      |
  | **Total**  | **942** |

- **Authorization matrix: 42 cases.** 8 group routes × {signed out, stranger, former member,
  member, owner}, plus malformed, unknown and deleted groups. Strangers and former members get
  404; members get 403 on owner-only actions.
- **Merge tests:**
  - a new user takes over memberships, payments and shares
  - the activity history is unchanged and the claim is recorded
  - an existing user's other groups are untouched
  - a conflict as an active or former member
  - two claims at once, through one invite or two groups' invites
  - a placeholder in two groups
  - a friendship becoming the claimer's own, or merging into theirs with both histories
  - a claimer who is the friend
- **Other integration tests:**
  - create, replay and ID conflict
  - adding by ID only for people I know
  - `myNet` from real expenses
  - rename, emoji, and the currency lock
  - delete only when settled
  - add, remove, bring back
  - leave, with ownership passing past a placeholder and the group closing with no one left
  - friendship restrictions
  - invites: token hash, 30-day expiry, preview, rate limit, joining, claiming, expiry (410),
    revoking
  - friends, including three concurrent requests making exactly one friendship
  - people
  - claims: case-insensitive, claim, dismiss, other users refused, conflicts left out, no account
    discovery
- **Bug injection: 19 of 20 caught.** The 20th, "merge ignores former members", is refused anyway
  by the primary key, as the same `MERGE_CONFLICT`. Caught:
  - former members keep access
  - a member deletes the group
  - removal or deletion with balances
  - ownership to a placeholder
  - currency change despite expenses
  - deleted groups listed
  - share rows not moved
  - transactions left behind in a merged friendship
  - no placeholder lock
  - racing add-friend unhandled
  - raw token stored
  - preview not rate-limited
  - plain join into a friendship
  - expired invite accepted
  - anyone revoking
  - conflicting claims offered
  - anyone added by ID
  - tokens reaching Sentry
- **End-to-end: 18 of 18** (9 tests × desktop and phone), with no console errors in either
  browser, the native dialogs and the share fallback included.
- **Docker image:** migrations run, and the smoke test passes 13 of 13.
- **Screenshots reviewed:** empty Home, the new-group form, the Members tab, the add-person bottom
  sheet, Home with lists, and the invite page signed out and choosing; desktop and phone.
- The main bundle is 385 kB (120 kB gzipped); the new pages load as their own chunks.

## Lined up next

**To finish Phase 6:**

1. **Commit and push** (nothing is committed). No new settings or migrations are needed.
2. **Check on staging:**
   - Create a group with a placeholder.
   - Open the invite link in another browser (a private window) and claim the placeholder.
   - Add a friend.

   Resend's test sender delivers sign-in codes only to your own address, so sign the second
   browser in with Google, using another Google account added as a test user.

**Phase 7: expense creation and editing** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 7:** creating an expense must lock the group row `FOR SHARE` (or recheck active
  membership in the same transaction). Otherwise a member could be removed between the balance
  check and an expense that names them. `FOR SHARE` waits for the `NO KEY UPDATE` that
  membership changes hold.
- **Phase 8:** `/home`, `GET /friends/:userId` and the friend page; people rows become links.
- **Phase 10:** activity reads must resolve old placeholder IDs through `users.merged_into`.
- **Later:** merging two placeholders in one group (now a conflict that the group resolves by
  removing one).
