# Fix: claiming a placeholder left `split_input` naming it

- **Date:** 2026-11-15
- **Status:** Done (not committed yet).
- **Found:** while planning v1.1 receipts (`docs/plans/receipt-scanning.md`, R0 "The merge gap").
  This fix is separate from v1.1; no receipt work was started.
- **Order agreed afterwards:**
  1. This fix.
  2. Phase 15: typed entry with the LLM, building the shared AI layer.
  3. v1.1 receipts: R0–R8, minus R3.
  4. Phase 14 (launch) when you decide to go live.

## The bug

**What the claim did.** `mergePlaceholder` (`apps/api/src/modules/claims/merge.ts`) repointed
memberships, payer rows and share rows from the placeholder P to the claimer U. It didn't touch
`transactions.split_input`, the split as it was entered, which edits reopen from. So every equal,
exact, percent or shares input that named P kept naming P after the claim.

**What that broke.** Opening such an expense to edit put P back in the form. P is no longer a
member, so saving failed (`NOT_A_MEMBER`, a 422) or showed the wrong person.

**Shown failing before the fix.** The new test `claim-split-input.test.ts` failed all 5 cases:

- in every round-trip case, `splitInput` still listed P while the payer and share rows already
  named U;
- in the stale-form case, saving an expense opened before the claim answered 422 where the fix
  answers 409 `VERSION_CONFLICT`.

## A finding while planning: leftover paise and user-ID order

**Why "same amounts after the rename" can't always hold.** `allocateProportional` sorts people by
user ID, and the seeded tie-break gives leftover minor units by position in that order. UUIDv7
IDs sort by creation time. So renaming P to U can change their position, and recomputing the
shares can move one paisa between two people. For example, ₹1,000 three ways leaves a paisa over:
before the claim it may land on P (now U); recomputed after the rename, it may land on someone
else.

**What does hold, and is now tested:**

- the same total;
- everyone within 1 minor unit;
- identical amounts when the rename keeps the same position.

**Decision: keep the stored shares.** When an edit leaves the amount and split input as stored,
the server keeps the stored shares instead of recomputing, and the edit form shows them. Any real
change to the split or amount recomputes as before.

**The alternatives:**

- **Re-round at the merge:** this moves money silently, breaking I11 unless an activity entry is
  added.
- **Let the next edit move the paisa:** an unchanged save would no longer be a no-op, and Activity
  would show a one-paisa change.

## What was built

### Core: `renameInSplit` (`packages/core/src/split/rename.ts`)

- `renameInSplit(split, from, to)` covers every `SplitInput` variant and returns the canonical form.
  If `to` is already in the split, it throws `InvariantViolation`, because the claim's conflict
  check makes that impossible.
- `splitInputUsers(split)` lists who a split names.
- `canonicalSplitInput` moved from `activity/diff.ts` into `split/canonical.ts`, so the snapshot,
  the rename, the service and the web form share one implementation. Next to it is
  `sameSplitInput(a, b)`.

### The claim (`apps/api/src/modules/claims/merge.ts`)

**What `rewriteSplitInputs(tx, from, to, groupIds?)` does.** It finds transactions whose split
input names `from`, using `jsonb_path_exists(split_input, '$.** ? (@ == $id)', …)`, deleted ones
included. It locks them `FOR NO KEY UPDATE`, renames, and bumps `version`.

**Where the merge calls it.** Right after reading P's memberships and before the friendship moves,
limited to P's groups, and in the same database transaction. The lock order is transaction rows,
then group, the same as the edit path.

**Version bump: yes, `version` only.**

- **Why bump:** a form left open from before the claim gets `VERSION_CONFLICT`, and the existing
  conflict dialog reloads fresh data naming U. That replaces a confusing member error.
- **`updated_at` is untouched:** it feeds the nightly I8 check (`left_at < coalesce(updated_at,
created_at)`). Bumping it would flag every transaction naming someone who left before the claim.
- **`updated_by` is untouched:** setting it would credit the claimer with an edit nobody made.
- **No activity entry:** the log is append-only, readers already resolve `merged_into`, and
  nothing ties versions to activity entries.

### Keeping the stored shares

- **Server** (`transactions/service.ts`): `prepareExpense(id, input, stored?)` reuses
  `stored.shares` when the amount matches and `sameSplitInput(input, stored.splitInput)`. `edit()`
  now reads the lines first and passes them to `prepare`. For every transaction that was never
  claimed, the result is identical (I5).
- **Web** (`features/expenses/split-draft.ts`): `evaluate` takes an optional `stored`. The edit
  route passes `storedSplitOf(tx)`, and the form holds it for its lifetime. While the draft
  matches, the preview shows the saved shares, so the preview equals what's saved.

### Repair of existing data (`apps/api/src/modules/claims/repair.ts`)

**What it does.** `repairClaimedSplitInputs(db)` makes one pass, over live and deleted inputs
alike, to find claimed placeholders still named anywhere. It renames each to whoever claimed it
with the same `rewriteSplitInputs`, so the version is bumped and shares are untouched. It's
idempotent.

**Where it runs:**

- The pre-deploy step `node dist/migrate.js` runs it after the migrations, as the owner role, and
  prints a count.
- `pnpm --filter @fairshare/api repair:split-inputs` runs it on its own.

**Script, not a SQL migration.** The rename needs `renameInSplit` and core's canonical order.
Writing that again in SQL for each variant, sorting included, would be a second implementation
that could disagree with the first. `packages/db` may not import core; the API's pre-deploy entry
can.

### Nightly check (`packages/db/src/invariants.ts`)

- **New check:** `claimedInSplitInput` (I12) finds live transactions whose split input names a user
  with `merged_into` set. It makes one linear pass:
  `jsonb_path_query(split_input, 'strict $.** ? (@.type() == "string")')` joined to `users`.
- **Output:** counts only, as before. The job now prints
  `{"transactionSums":0,"groupNets":0,"inactiveMembers":0,"claimedInSplitInput":0}`.

### Docs

- **`ARCHITECTURE.md`:**
  - the claiming steps;
  - the repair;
  - "an unchanged split keeps its stored shares";
  - I5's wording;
  - I12 in the invariants table;
  - which invariants the nightly job checks;
  - a plan-corrections row.
- **`docs/operations.md`:** the I12 finding and its repair, and the restore note.
- **`docs/deploy-staging.md`:** the pre-deploy step's new output line.
- **`docs/plans/receipt-scanning.md`:** saved, with the new build order. R3 is marked as built in
  Phase 15, the merge gap is marked done here, and the receipt plan's itemized invariant is now
  I13.

## Tests

| Where                                                                                      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules/claims/claim-split-input.test.ts` (new, 5)                           | Through the real API: equal, exact, percent, shares and multiple payers naming P, all reopened and saved unchanged after the claim. Each names U with the pre-claim amounts and is a no-op (same version, no `transaction.updated`). Also: a deleted expense after restore; a form opened before the claim gets 409; the drift case (the test searches for an expense ID where recomputing would move a paisa) keeps the stored shares; P's friendship expenses moved into U's existing friendship round-trip too. |
| `packages/core/src/split/rename.test.ts` (new, 5 unit + 5 property tests, 1,000 runs each) | No other ID or value changes; the output is canonical (`canonicalSnapshot` leaves it as is); renaming back gives the original; `computeShares` keeps the total and everyone within 1 minor unit (exact splits identical); identical shares when the new ID sorts in the same position.                                                                                                                                                                                                                             |
| `apps/api/src/modules/transactions/prepare.test.ts` (new, 4)                               | Stored shares kept when unchanged, whatever the order; recomputed when the split or amount changes, or nothing was stored.                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/features/expenses/split-draft.test.ts` (+3)                                  | The edit form shows saved shares while unchanged, and recomputes otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/api/src/modules/claims/repair.test.ts` (new, 1)                                      | Seeded broken rows for every method, plus a deleted one and one moved into a friendship: all repaired, versions bumped, `updated_at`, `updated_by` and shares untouched; an unrelated expense and a settlement untouched; a second run repairs 0.                                                                                                                                                                                                                                                                  |
| `packages/db/src/invariants.test.ts` (+1)                                                  | A live split input naming a claimed placeholder is found; a deleted one isn't; the report and summary include the new count.                                                                                                                                                                                                                                                                                                                                                                                       |

## Verification

- **`pnpm check`:** passes. Format and lint are clean, typecheck passes, and 1,508 tests pass (api
  493, core 392, contracts 287, web 170, db 102, api-client 64).
- **End-to-end:** `pnpm build` then the full suite: 78 passed (desktop and Pixel 7, accessibility
  scans included).
- **Development database:**
  - The invariant check before: all counts 0, including `claimedInSplitInput`.
  - `repair:split-inputs`: 0 repaired, then 0 again.
  - The invariant check after: all 0.
  - The development database has no claimed placeholders (2 placeholders, neither claimed), so 0
    is correct.
- **Repair drill on a copy of the development database** (`CREATE DATABASE … TEMPLATE fairshare`,
  dropped afterwards):
  - seeded one claim the old way;
  - the invariant check found `claimedInSplitInput: 1` and exited 1;
  - the repair fixed 1, then 0 on the second run;
  - the invariant check came back clean;
  - the expense's version went from 1 to 2, and its split input names the claimer.

## Notes

- **Who is affected:** staging may have claims made before this fix. The first deploy's pre-deploy
  step repairs them and prints how many.
- **Phase 13 status:** its dev log is still marked "In progress". Its commit is in, so it can be
  marked done whenever you say.
