# Phase 7: Expense creation and editing

- **Dates:** 2026-11-12 (code part)
- **Status:** Done. Committed as aa85f6d; CI, the deploy and the staging check (add, edit, delete
  and undo an expense; its history; deleting a group from its settings) passed.
- **Plan reference:** Implementation blueprint §4.4 (expense management), §4.5 (split engine),
  §4.9 (activity), §6.3 (transaction endpoints), §7.1 (cross-cutting patterns), §7.3 (Add Expense),
  §10.4 (lifecycle and concurrency tests), §10.5 (end-to-end), §11 Phase 7

## Goal

Expenses end to end: create (with idempotent replay), read, list, edit with optimistic
concurrency, delete and restore, and history. On the web: the Add Expense form (equal split, one
payer), optimistic saving with Undo, the edit form with its conflict dialog, the expense page with
its history, and the group's Expenses tab.

## What was built

### API (`apps/api/src/modules/transactions/`)

| Route                            | What it does                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /groups/:id/expenses`      | Creates an expense: 201, or 200 for an identical replay of the same ID; `ID_CONFLICT` otherwise |
| `GET /groups/:id/transactions`   | Newest first, keyset cursor; `q`, `person`, `type`, `from`, `to`, `includeDeleted`              |
| `GET /transactions/:id`          | Any transaction of a group I'm in, deleted ones included                                        |
| `PUT /transactions/:id`          | Replaces an expense; `If-Match` required; settlements in Phase 9                                |
| `DELETE /transactions/:id`       | Soft delete with `If-Match`; repeating it is a no-op                                            |
| `POST /transactions/:id/restore` | With `If-Match`; refused (`MEMBER_INACTIVE`) once someone in it has left                        |
| `GET /transactions/:id/history`  | The activity entries, oldest first, with "involves me"                                          |

- **`service.ts`:** `prepareExpense` runs core's `validatePayers`, `computeShares` (seeded with the
  expense ID) and `assertTransactionInvariants`, then builds the canonical snapshot. The service
  adds the group checks (currency, date, members), the replay comparison and the locks.
- **`repo.ts`:** rows and lines, the keyset query, `people()`, which shows a claimed placeholder as
  its claimer, and the history.
- **New error code:** `TRANSACTION_DELETED` (409), for editing a deleted expense.
- **API client:** `transactions`, `createExpense`, `transaction`, `updateExpense`,
  `deleteTransaction`, `restoreTransaction`, `transactionHistory`.

### Web (`apps/web/src/features/expenses/`, routes)

- **`/groups/$groupId/expenses/new`:** a modal route over the group page, so Back closes it.
  - Amount with the decimal keypad, then description, then a summary chip: "Paid by you · Split
    equally between all 3 · ₹400.16–₹400.17 each".
  - The chip opens the payer and participant choices, with each person's exact amount.
  - Date chips (Today, Yesterday, any date), with a warning for a future date; optional notes;
    a sticky Save.
  - The last payer and participant set are remembered per group on this device.
- **Optimistic saving (`use-create-expense.ts`):**
  - The form closes, and the expense shows in the list as "Saving…".
  - A toast reads "Added ‘Dinner’ · ₹2,400.00 · Undo"; Undo deletes it, waiting for the save if
    it's still in flight.
  - If the save fails, the list rolls back, and a toast reopens the form with everything as typed
    and the same ID.
- **`/transactions/$id`:**
  - Amount, date, who last changed it, my effect in words ("You lent ₹1,600.00"), notes, who
    paid, each share.
  - Edit, Delete (confirm, then a toast with Undo), Restore for a deleted one.
  - History in sentences: "Asha changed the amount ₹1,200.00 → ₹1,500.00 and added Chitra to the
    split" (`history.ts`, through core's `diffSnapshots`).
- **`/transactions/$id/edit`:**
  - The same form with `If-Match`.
  - On `VERSION_CONFLICT`, a dialog explains that nothing was overwritten and offers to reload
    the other person's version.
  - Expenses this editor can't represent (several payers, unequal splits) open read-only, with a
    note.
- **Expenses tab:**
  - Grouped by month, with a search box and a "Show deleted" switch.
  - Rows show who paid and my effect ("you lent", "you borrowed", "not involved"); settlements
    have their own icon.
  - More rows load as you scroll, with a "Load more" fallback.
- **Group page:**
  - "Add expense" in the header on desktop and a floating button on phones.
  - The `n` key opens a new expense, unless someone is typing.
- **Shared pieces:**
  - A toast system (`lib/toast.ts`, `components/ui/toaster.tsx`).
  - Dialogs get a ✕ Close button and a full-screen size for phones.
  - Query invalidation after any transaction change, as in Blueprint 7.1: the group, its lists,
    my groups, friends, the transaction itself.

## Decisions and deviations

- **The editor supports an equal split with one payer**, as the plan schedules for Phase 7. The API
  already takes every split method and several payers; expenses made that way show read-only in
  the editor until the full split sheet arrives.
- **Editing a settlement** answers "isn't available yet" until Phase 9, which owns settlement
  validation. Delete and restore already work for both kinds.
- **A replay compares content** (the canonical snapshot, which includes the computed lines), plus
  the creator and group. If the replayed body is itself invalid, it's `ID_CONFLICT`.
- **An unchanged edit** returns the expense without a new version or history entry.
- **Repeating a delete** returns the deletion as it is; restoring an expense that isn't deleted
  returns it unchanged.
- **The date limit** ("today + 365") uses UTC today on the server. For India, UTC today is at most
  a day behind local today, which the year's margin absorbs.
- **The group row is share-locked while an expense is written,** as I noted in Phase 6. A test
  shows that without the lock an expense and the removal of a person it names can both succeed.
- **History shows a claimed placeholder as its claimer**, which is the read-time resolution from
  the Phase 6 plan correction, done here for history. The Activity feed (Phase 10) will reuse it.
- **The 'n' shortcut** is on the group page only. The Home "＋ Expense" button with a group picker
  comes with Home in Phase 8.
- **The first failure handling is a toast** with "Open", not an automatic reopening of the form,
  because by then the person may be on another screen.
- **Bundle:** the main bundle is 283 kB (92 kB gzipped). A shared 114 kB chunk (33 kB gzipped),
  most likely the contracts schemas, loads with it.

## Problems found and fixed

1. **Phase 6's "Delete group" was broken (and still is on staging until this deploys).** My dialog
   component treated the browser's `close` event as the user closing it, including when the code
   itself closed one dialog to open another. So:
   - Choosing "Delete group" in the settings dialog closed everything, and the confirmation never
     appeared.
   - Edit's conflict dialog vanished the same way. The new conflict test is what found this.

   The component now ignores the `close` it causes itself. A new end-to-end test deletes a group
   from its settings; it fails with the old component and passes with the fix.

2. **The full-screen form had no way out on phones** (screenshot review): no backdrop to tap and no
   Esc key. Every dialog now has a ✕ Close button, and a test checks both Close and the Back
   button.
3. **Reading refs during render** in the new-expense route (React's hooks lint). It now uses lazy
   `useState`.
4. **A weak test:** the wildcard-search test passed even without escaping. It now uses data where
   `%` and `_` would match the wrong rows if they acted as wildcards.
5. **A flaky end-to-end test:** each test sent a random client IP from 254 addresses, so two of the
   now 28 tests often shared one, and with it Better Auth's 3 attempts a minute. They now pick
   from 16 million.
6. **End-to-end tests used the session before it existed:** the API helper ran before sign-in
   finished. The tests now wait for Home.
7. **The Playwright browser was deleted again** (`~/.cache/ms-playwright` only; the rest of
   `~/.cache` was untouched), so something on your machine cleans it. It was reinstalled. If it
   keeps happening, `PLAYWRIGHT_BROWSERS_PATH=0` keeps the browser inside `node_modules` instead.

## Verification

- `pnpm check` passes.

  | Package    | Tests   |
  | ---------- | ------- |
  | core       | 247     |
  | contracts  | 283     |
  | api-client | 55      |
  | db         | 97      |
  | api        | 274     |
  | web        | 21      |
  | **Total**  | **977** |

- **Expense integration tests (25):**
  - shares equal to core's computation from the same seed
  - nets and the activity entry
  - refusals: wrong currency, a stranger, a former member, payer and split sums with core's codes,
    a date over a year ahead, someone else's AI request
  - replay (200), different body (409), same ID twice at once (one stored, one history entry)
  - edit: a new version with before and after, by any member, stale (409 with the current version),
    missing If-Match (428), unchanged body (no-op), two edits at once (one wins), a deleted expense
  - delete and restore, with balances following
  - restore refused once someone left; deleted expenses readable
  - the list: ordering across pages, stable while adding; filters and search combined; `%` and `_`
    literal; bad cursor and reversed range (400)
  - history; 20 creates at once (all stored, nets sum to zero)
  - an expense racing a member's removal (5 rounds)
  - rollback of a half-written expense with its activity
  - access: strangers and former members get 404 on every route
- **Bug injection: 15 of 15 caught:**
  - no version check
  - If-Match optional
  - replay ignoring the body
  - any currency
  - strangers or former members in a split
  - restore ignoring who left
  - shares not seeded by the ID
  - keyset repeating a row
  - deleted ones always listed
  - search wildcards unescaped (after strengthening the test)
  - anyone reading any expense
  - no row lock on edits
  - deletion recorded wrongly
  - edit keeping the old lines

  The group share lock has its own test, which fails 3 of 3 runs without the lock.

- **End-to-end: 28 of 28** (14 tests × desktop and phone), no console errors:
  - add with the preview, edit, delete and undo
  - undo straight after adding
  - a real conflict, then reload
  - close with ✕ and with Back
  - delete a group from its settings
  - all the earlier journeys
- **Docker image:** migrations run, and the smoke test passes 13 of 13 with no error logs.
- **Screenshots reviewed:** the open form on a phone (the paisa split shows exactly), the Expenses
  tab, and the expense page.

## Lined up next

**To finish Phase 7:**

1. **Commit and push** (nothing is committed). No new settings or migrations.
2. **Check on staging:**
   - Add an expense in a group, edit it, delete it and undo.
   - Open it from the list and read its history.
   - Delete a group from its settings: this was broken on staging, and the fix arrives with this
     push.

**Phase 8: balances and Home** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 8:**
  - The Balances tab, `/home` with the "＋ Expense" button and its group picker, and the friend
    page.
  - After an expense, also invalidate the friend keys of the people in it.
- **Phase 9:** editing settlements through `PUT /transactions/:id`.
- **Phase 10:** the Activity feed reuses `people()` to show claimed placeholders as their
  claimers.
- **Phase 14:** look at the 114 kB shared chunk; subpath imports from contracts would let pages
  load only the schemas they use.
