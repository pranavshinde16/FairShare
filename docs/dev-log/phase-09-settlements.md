# Phase 9: Settlements

- **Dates:** 2026-11-12 (code part)
- **Status:** In progress. The code is done and verified locally (integration, end-to-end, Docker
  image). It goes live with the next push; then check it on staging (see "Lined up next").
- **Plan reference:** Implementation blueprint §4.8 (settlements), §5.5 (worked settlement), §5.6
  (editing after a settlement), §4.9 (activity snapshots), §6.3 (settlement and transaction
  endpoints), §7.2 ("Settle payment" modal, Balances tab, friend detail), §10.3–10.5 (settlement
  tests), §11 Phase 9, C5 (friend settle-up per group)

## Goal

The full core loop: log → balance → settle → zero. Record a payment, edit, delete and restore it
through the existing transaction endpoints, and settle from the group's suggested payments or from
a friend's page.

## What was built

### API

| Route                              | What it does                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /groups/:id/settlements`     | Records "from paid to": 201 with the transaction, 200 for an idempotent replay of the same body |
| `PUT /transactions/:id`            | Now edits settlements too, with an `UpdateSettlement` body; expenses as before                  |
| `DELETE`, `POST …/restore`, `GET…` | Unchanged; they already handled both types                                                      |

- **`service.ts`:**
  - One `create` (client ID, idempotent replay, ID_CONFLICT otherwise) and one `edit` (If-Match,
    no-op when unchanged, activity before/after) shared by expenses and settlements. Each type
    passes how to check and build itself.
  - `prepareSettlement`: core's `settlementLines` (one payer, one recipient, same amount; paying
    yourself is SETTLEMENT_SAME_USER), `assertTransactionInvariants`, and the snapshot.
  - `checkAgainstGroup`: the group's currency, the date (up to a year ahead) and that everyone
    named is an active member (NOT_A_MEMBER, MEMBER_INACTIVE), with the group held still. It's the
    old expense check, now shared.
  - `updateTransaction`: checks access, then validates the body against the stored type's schema.
  - Messages say "payment" for settlements ("Someone in this payment has left the group …").
- **`http/validate.ts`:** `parseBody`, for a body validated once the schema is known.
- **Core:** `TransactionSnapshot` gains `paymentMethod` and `paymentRef` (settlements only), and
  `diffSnapshots` reports changes to them. `PaymentMethod` type exported.
- **Contracts:** `TransactionSnapshot` accepts the two fields. (`CreateSettlement`,
  `UpdateSettlement` and the error code were already there from Phase 2.)
- **API client:** `createSettlement`, `updateSettlement`.

### Web

- **Settle form** (`features/settlements/settle-form.tsx`): From and To (with a swap button),
  amount, method (UPI / Cash / Bank / Other), date, an optional reference and note. Under the
  amount: "This is ₹200.00 more than Bilal owes." while it's over, and "Use the suggested ₹950.00"
  when the amount differs from the suggestion.
- **Overpayment question** (`settle-dialog.tsx`): "Record anyway? This is ₹200.00 more than Bilal
  owes." with "Change amount", which brings the form back as it was, or "Record anyway".
- **Where it opens:**
  - Balances tab: "Settle" on every suggested payment (filled with it; mine are the solid buttons)
    and "Record a payment" (filled with my own suggested payment, if any).
  - Friend page: "Settle" on each group with a balance, including "Just the two of you" (C5).
  - Both are modal routes, so Back closes them: `/groups/:id/settle?from=&to=` over the group,
    `/friends/:userId/settle?groupId=` over the friend page.
- **After recording:** "Recorded: Bilal paid you ₹950.00" with Undo; balances, Home and friend
  pages refresh through the invalidation map; the changed balance briefly lights up.
- **Payments in the history:** "Bilal paid you · Payment · UPI" with "you received ₹950.00" in
  neutral grey (a payment isn't a debt). The payment page shows who paid whom, the method and
  reference, Edit and Delete ("Delete the payment?"). Edit opens the same form ("Edit payment"),
  with the same "someone changed this" reload as expenses.
- **History sentences:** "Asha recorded it", "Asha changed the method to Cash, who paid to Chitra
  and the amount ₹950.00 → ₹1,000.00"; a payment's amount reads once, not as a payment and a share
  too.
- **"All settled up"** on the Balances tab, "You’re settled up" on the position and friend page, and
  "You’re all settled up" on Home, now reachable by settling.

## Decisions and deviations

- **What counts as an overpayment.** The plan says to compare "against the suggested transfer and
  the payer's outstanding debt". A payment is treated as over when it's more than the payer owes in
  the group, or more than the recipient is owed: those are the two ways a balance flips. Paying
  someone other than the suggestion isn't over by itself (the suggestions re-route around it), and
  the question says which side it goes past ("… more than Bilal owes" / "… more than Asha is
  owed"). Editing a payment is checked against the balances without that payment.
- **Settlement snapshots include the method and reference.** Without them, changing only the method
  would look like no change at all: no new version and no history line. This was already on the
  plan corrections list; it's now done there. Expense snapshots are unchanged.
- **`PUT /transactions/:id` validates in the service,** since the body's shape depends on the stored
  type. Access is checked before validation, so a stranger gets 404 whatever they send.
- **The default method** is UPI for rupee groups and Cash otherwise. The plan lists UPI first; a
  friendship in dollars defaulting to UPI would be wrong.
- **"Animates to its new value"** is a short highlight of the balance card (and the position line
  and friend total) when the value changes, off for people who prefer reduced motion. Counting the
  number up would show intermediate amounts that were never balances.
- **Payments are saved before the dialog closes,** unlike expenses (which appear at once and save in
  the background). The form shows a server refusal in place, and the payment's ID is fixed per
  opening, so a retry after a lost response can't record it twice.
- **Settling across groups** ("pay Rahul ₹1,200 total", Blueprint 5.5) stays out, per C5.

## Problems found and fixed

1. **The end-to-end server runs the built API,** so the first end-to-end run hit the old build and
   got 404 for the new endpoint. Rebuilt; nothing in the app was wrong.
2. **Removing only the notes read "Asha changed removed the notes".** The history sentence now puts
   "changed …" parts first and "added/removed …" parts after ("… and removed the notes"), and says
   "your" rather than "you’s" for the reader.
3. **Opening one dialog as another closed could leave the page scrollable** behind it. Dialogs now
   count scroll locks, so the page stays locked until the last one closes.
4. **The friend page's group link and its new "Settle" link both matched `/Goa Trip/`** in an
   existing end-to-end test; the test matches the group link from its start now.
5. **"You received ₹950.00" showed in red** on the payment page, as if it were a debt. Payments
   show in neutral grey there, as in the list.

## Verification

- `pnpm check` passes.

  | Package    | Tests     |
  | ---------- | --------- |
  | core       | 251       |
  | contracts  | 285       |
  | api-client | 60        |
  | db         | 97        |
  | api        | 309       |
  | web        | 47        |
  | **Total**  | **1,049** |

- **Settlement integration tests (24):**
  - recording (Blueprint 5.5): one payer and one recipient, A +900, B 0, C −150, D −750, both sides'
    `myNet`, the activity entry with method and reference
  - anyone records for any two members, placeholders included
  - partial payment; overpayment flips the direction
  - settlement money apart in the explanation; listing and filtering by type and person
  - settling every suggested payment reaches zero for everyone, on Home and friend pages; the same
    for a random group (seed 20261112: 6 people, 30 expenses with multiple payers and share splits,
    partial payments along the way)
  - a friendship settled from the friend page's numbers
  - editing an expense after a payment (Blueprint 5.6): A +800, B +200, C −250, D −750, Bilal owed
  - editing a payment: new version and history; method or reference alone; turning it around;
    unchanged body is a no-op; stale version, missing If-Match, deleted; the wrong body type and an
    incomplete body; the same rules as recording
  - delete and restore; restore refused once a party left
  - idempotency: replay (also with upper-case IDs), five kinds of ID conflict, two identical
    requests at once
  - validation: 18 bad bodies, nothing written; a date a year ahead accepted
  - access: anonymous 401; strangers and former members 404, whatever the body
- **Bug injection: 19 of 19 caught** (one was missed at first, the looser edit schema; a test for
  incomplete edit bodies now catches it):
  - payer and recipient swapped; method left out of snapshots; membership or currency not checked;
    any body replaying; a looser schema for edits; validation before the access check
  - note or reference dropped; deleted payments editable; 200 instead of 201; paying yourself
    allowed
  - (web) overpayment ignoring the recipient; edits checked with the payment counted twice; history
    repeating amounts; "added" for payments
  - (end-to-end) balances not refreshed after recording; the overpayment question skipped; the
    friend page paying the wrong way
- **End-to-end: 40 of 40, twice** (20 tests × desktop and phone), no console errors. New:
  - settling Bilal's suggested payment, the payment in the history and on its page, then
    correcting the dinner: Bilal now gets back ₹200
  - the overpayment question and "Change amount", "Use the suggested", Undo, settling to zero,
    Home settled, editing the payment's method and its history line
  - settling with a friend from their page, past what they owe, in dollars
- **Docker image:** migrations run (twice, idempotent), the smoke test passes, the new route
  answers 401 without a session, no error logs.
- **Screenshots reviewed:** the Balances tab with Settle buttons, the form and the overpayment
  question on a phone, the list and payment page, the edit form, a friend page with Settle.

## Lined up next

**To finish Phase 9:**

1. **Commit and push** (nothing is committed). There are no new settings and no migrations.
2. **Check on staging:**
   - In a group with expenses, open Balances and press "Settle" on a suggested payment: the form
     is filled in; record it and watch your balance change.
   - Type more than is owed: the question appears; "Change amount" keeps what you typed.
   - Open the payment from the Expenses tab, edit its method, and see the history line.
   - Settle with a friend from their page.

**Phase 10: activity feed and history search** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 10:** the Activity tab will show "Asha recorded a payment: Bilal paid you ₹950"; the
  history sentences built here are its starting point. History search and filter chips (person,
  type, date) use the list filters the API already has.
- **v1.1:** "Pay via UPI" above the form (Blueprint 4.8), and a "settle all" helper across groups
  if people ask for it (C5).
- **Phase 14:** the 114 kB shared chunk noted in Phase 7.
