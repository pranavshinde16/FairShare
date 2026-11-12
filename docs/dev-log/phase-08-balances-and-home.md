# Phase 8: Balances and Home

- **Dates:** 2026-11-12 (code part)
- **Status:** Done. Committed as c63675e; CI, the deploy and the staging check (the Balances tab
  with a member's explanation, Home's totals, a friend page, "＋ Expense" from Home) passed.
- **Plan reference:** Implementation blueprint §4.3 (friend detail), §4.6 (ledger and balances),
  §4.7 (simplification and how the UI explains it), §6.3 (Home, friends, balances endpoints), §7.1
  (query keys and invalidation), §7.2 (Home, Balances tab), §10.4 (friend consistency, load sanity),
  §10.5 ("View balances"), §11 Phase 8

## Goal

Correct balances everywhere, consistent across Home, groups and friends: the group's Balances tab,
Home's totals and lists, the friend page, and an invalidation map so every change refreshes every
screen that shows it.

## What was built

### API (`apps/api/src/modules/balances/`)

| Route                      | What it does                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /groups/:id/balances` | Every member's net, the suggested payments, my own position, and what each net is made of                |
| `GET /home`                | Totals per currency (owed, owe), my groups with my net and last activity, the people I owe or who owe me |
| `GET /friends`             | Moved here from the friends module, unchanged in behaviour                                               |
| `GET /friends/:userId`     | What we settle in each group we share, and the total; 404 if we share none                               |

- **`service.ts`:** builds all four from the same pieces, so the numbers can't drift apart:
  - The group's balances come from one read of its payer and share rows, summed per person,
    currency and type. Nets, core's `simplify` (after `assertNetsSumToZero`), my position and the
    explanation all come from that read.
  - Friend balances (`pairwise.ts`, from Phase 6) simplify each group and keep the transfers
    between me and the other person. Home and the friend page use the same function.
- **`repo.ts`:** `ledgerTotals` (the group read), `netsForGroups` (the ledger view, as before),
  `lastActivity` (the newest activity entry per group), `sharedGroups`.
- **Contract change:** the balance explanation gains `sent` and `received` (settlement money), next
  to `paid` and `share` (expenses). See "Decisions".
- **API client:** `home`, `groupBalances`, `friend`.
- **The balance checks for removing a member, leaving and deleting a group** were already real: you
  agreed in Phase 6 to build them on the ledger instead of a stub, so nothing changed there.

### Web

- **Balances tab** (`features/balances/balances-tab.tsx`), in the order Blueprint 4.7 explains it:
  - "Your balance": "You’re owed ₹1,850.00", "You owe …" or "You’re settled up".
  - "Suggested payments": the payments involving me first ("Bilal pays you ₹950.00"), then the
    others; "All settled up" when there are none; "How payments are suggested" opens the
    simplification note.
  - "Everyone’s balance": each member's net in words ("gets back", "owes", "settled up"); opening a
    row shows "Paid for expenses", "Share of expenses", and settlement money when there is some.
- **Group page:** my position ("you’re owed ₹1,850.00 · Balances") sits above the tabs on every tab
  but Balances (the plan pins it on phones).
- **Home** (now from `GET /home`):
  - Under the greeting: "You’re owed ₹4,250.00 · You owe ₹800.00", one line per currency, or
    "You’re all settled up".
  - Groups and people with a balance first; settled ones fold behind "2 settled groups".
  - People link to their friend page.
  - "＋ Expense" (a header button on desktop, the floating button on phones, the `n` key) asks
    "Who is it with?", listing groups and people, then opens the form there. Picking someone I
    only share groups with opens our friendship first.
- **Friend page** (`/friends/:userId`):
  - "Bilal owes you ₹950.00" overall, then "By group", each linking to that group's balances.
  - "Between you two": the friendship's expenses.
  - "Add expense" (and `n`) opens the form over the friend page (`/friends/:userId/expenses/new`),
    opening the friendship first if there isn't one yet.
  - "Invite Bilal" for a friend who hasn't joined, as the friendship's Members tab offered.
- **Links to friends** go to the friend page: Home, the sidebar, after "Add a friend", and the back
  link on an expense from a friendship.
- **The sidebar** reads `GET /home` too, so Home makes one request instead of three.
- **Invalidation map** (`lib/invalidation.ts`): one table from each kind of change to the keys it
  makes stale. Every mutation now goes through it:
  - expenses: create, edit, delete, restore;
  - membership: create a group, add, remove, leave, delete, add a friend, accept an invite, claim;
  - group details: name, emoji, currency;
  - profile.

  Profile changes invalidated nothing before, and a claim now refreshes every group, since a claim
  can reach several.

## Decisions and deviations

- **Settlement money is kept apart in the explanation.** The contract had `paid` and `share` per
  member, which only explain a net while there are no settlements. Once Bilal pays Asha ₹950, folding
  that into `paid` and `share` would show Asha "sharing" ₹950 more. The breakdown now reports
  `sent` and `received` beside them, and a test checks `net = paid − share + sent − received`. The
  change is additive. It's added to the plan corrections table in ARCHITECTURE.md.
- **Home's totals add each group's net separately, positives and negatives apart,** as Blueprint
  4.6 specifies. If Rahul owes me ₹500 in one group and I owe him ₹300 in another, Home says "You’re
  owed ₹500 · You owe ₹300", while his row in People says "owes you ₹200". The difference
  (owed − owe) always equals the sum of the People rows; a test checks this for every user in a
  random scenario. The per-group split matches how debts are actually settled (per group).
- **The balances query reads the tables, not the `ledger` view** (see "Problems" 1). The view stays
  the definition for Home and friends; the consistency test compares the two paths.
- **The plan's `['groups']` and `['friends']` query keys are gone from the web:** Home carries both
  lists, and the sidebar and Home read it. `GET /groups` and `GET /friends` remain in the API.
- **Desktop Home shows the lists in the main column,** not the plan's "most recent group open in
  the main area". The sidebar already lists groups and people, and the group page is one click away.
- **The "Settle" buttons** next to suggested payments arrive with Phase 9, which builds settling.
- **The load threshold:** 50 ms locally, as the plan says (about 29 ms here); on CI, 150 ms, so a
  slower shared runner doesn't fail the build while a regression of a different order (a lost index,
  a query per expense) still does.

## Problems found and fixed

1. **The first balances query took 38 ms at p95** on the plan's load test (5,000 expenses, 12
   members): passing, but with too little room. Joining the ledger view back to `transactions` for
   the type cost a third of it. Reading the payer and share rows directly with their transaction is
   27 ms (p50) and 29 ms (p95). Adding the type to the view instead would have needed a migration and
   was slower (26 ms vs 23 ms for the query alone).
2. **The friend journey test expected the friendship's Members tab** after "Add a friend". It now
   lands on the friend page, which has the same "Invite Chitra" link.
3. **A test assumed rupees for a new friendship;** a friendship takes the creator's default
   currency, which follows the browser (USD in the test browser). The test was wrong; the app was
   right.
4. **The sidebar's "People" section is also a region named "People",** so two end-to-end locators
   matched twice on desktop. They're scoped to the main column now.

## Verification

- `pnpm check` passes.

  | Package    | Tests   |
  | ---------- | ------- |
  | core       | 247     |
  | contracts  | 283     |
  | api-client | 58      |
  | db         | 97      |
  | api        | 285     |
  | web        | 21      |
  | **Total**  | **991** |

- **Balance integration tests (11):**
  - the Goa example (Blueprint 5.3): the nets, the three payments (B → A ₹950, D → A ₹750,
    C → A ₹150), my view from two sides, and each member's paid and share
  - the same numbers on Home and the friend pages, from both sides
  - delete drops the expense everywhere (balances, Home, friends); restore brings back exactly the
    same balances
  - a settlement (Blueprint 5.5): A +900, B 0, its money reported apart, Bilal settled on Home
  - a new group lists everyone at zero in its currency; someone who left is gone, and so is their
    friend page
  - Home's order (balances first, then latest activity) and totals per group and currency
  - every screen agrees: 5 people, 3 groups (one in USD), 2 friendships and 40 random expenses with
    several payers and uneven shares. For everyone: Home's totals equal their group nets,
    Σ friend balances equals owed − owe, each friend page equals the list and the group payments,
    and A's view of B is the negative of B's view of A.
  - access: anonymous 401; strangers, former members, myself and bad IDs 404
  - load: 5,000 expenses, 12 members, p95 under 50 ms (about 29 ms here)
- **Bug injection: 14 of 14 caught:**
  - deleted expenses counted
  - Home netting groups together
  - friend balances losing their sign
  - friend pages for strangers
  - settled members dropped from a group's list
  - settlements mixed into paid and share
  - Home groups not ordered by balance
  - the oldest activity used as "last"
  - owes and owed swapped
  - a friend who left still counted as sharing the group
  - settled non-friends kept in the list
  - one currency only in the totals
  - no zero row for a settled group on a friend page
  - (web) adding an expense not refreshing Home: caught by the end-to-end test
- **End-to-end: 34 of 34, twice** (17 tests × desktop and phone), no console errors:
  - the Goa example on screen: the position line, "Your balance", the three payments, Bilal's
    explanation, Home's totals and People, Bilal's friend page
  - "＋ Expense" from Home through the picker, then Home's totals update without a reload
  - an expense with a new friend from their page, back on that page with the new balance
  - the friend journey now lands on the friend page
  - all the earlier journeys
- **Docker image:** migrations run (twice, idempotent), the smoke test passes 13 of 13, no error
  logs.
- **Screenshots reviewed:** the Balances tab and the friend page on a phone, Home on a phone and on
  desktop, the group page with its position line, the "Who is it with?" picker.

## Lined up next

**To finish Phase 8:**

1. **Commit and push** (nothing is committed). There are no new settings and no migrations.
2. **Check on staging:**
   - In a group with a few expenses, open Balances: your position, the suggested payments, and a
     member's explanation.
   - Home: the totals line, groups and people with balances first.
   - Open a person from Home: their total and the groups it comes from.
   - "＋ Expense" on Home: pick a group, save, and see Home's totals change.

**Phase 9: settlements** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 9:**
  - "Settle" buttons on suggested payments and on the friend page's groups.
  - Settlement edits through `PUT /transactions/:id`.
  - "Paid back" and "Received back" will start showing in the explanation.
- **Phase 10:** the Activity feed; `['activity']` is already in the invalidation map.
- **Phase 14:** the 114 kB shared chunk noted in Phase 7.
