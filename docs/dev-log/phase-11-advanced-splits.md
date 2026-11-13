# Phase 11: Advanced splits

- **Dates:** 2026-11-13 (code part)
- **Status:** In progress. The code is done and verified locally (unit, component, integration,
  end-to-end, Docker image). It goes live with the next push; then check it on staging (see "Lined
  up next").
- **Plan reference:** Implementation blueprint §4.5 (split engine, multiple payers), §7.3 (the Add
  Expense experience: the Split sheet, smart defaults, edit mode), §7.2 (expense details: the
  "input" view), §11 Phase 11

## Goal

Every split type in a fast UI: Exact, %, and Shares beside Equal, several payers, edits that reopen
exactly as entered, and remembered defaults per group.

## What was built

### Web

- **The split sheet** (`features/expenses/split-sheet.tsx`), behind the summary chip ("Paid by
  you · Split equally between all 4 · ₹600.00 each"):
  - **Paid by:** one person (as before), or "Several people paid": tick who paid, type what each
    paid, see "₹500.00 left to assign", or press "Split payment equally". "One person paid" goes
    back (to whoever paid most).
  - **Split:** a segmented control, Equal · Exact · % · Shares.
    - Equal: the checklist, Everyone / Nobody, each person's share, and "₹33.33 each, and ₹0.01
      more for 1 person" when it doesn't divide evenly.
    - Exact: an amount per person, "₹100.00 left to assign" (green "All assigned" at zero, "too
      much" when over), "Assign remaining to…".
    - %: a percentage per person with its ₹ beside it, what's left of 100%, "Fill remainder".
    - Shares: − / + steppers (0 leaves someone out) with each person's ₹.
  - **One message at a time** under the form, in form order: the amount, the description, who paid,
    the split. Save stays disabled until it's all valid.
- **The form's state and rules** (`features/expenses/split-draft.ts`, no React):
  - `evaluate`: the payers, the split, the preview shares, what's left, and the one problem.
  - `expenseBody`: the request, only when valid. Only entries above zero are sent.
  - `draftFromExpense`: an expense back into the form (edit mode, and reopening a failed save).
  - Shortcuts: `switchMethod`, `assignRemaining`, `fillRemainder`, `splitPaymentEvenly`, and
    switching between one payer and several.
  - `newDraft` / `toRemember`: smart defaults.
- **Edit mode:** every expense is editable now (Phase 7 allowed only one payer and an equal split).
  The sheet opens by itself for anything but one payer and an equal split, on the right tab, with
  the values as typed ("33.33", "2 shares").
- **Switching tabs** starts each method from the current split, so it's valid at once:
  - exact from everyone's current share;
  - percent as an even 100% (rounded by the same seed);
  - shares as 1 each.
    Each tab keeps what was typed in it.
- **Smart defaults:** the last single payer and equal-split participants are remembered per group
  on this device (as since Phase 7). A split between only some members shows "Split with
  everyone".
- **The expense page** shows what was typed beside each share: "40% · ₹480.00", "2 shares ·
  ₹600.00" (Blueprint 7.2's "input view"), under "Split by percentages", "Split by shares" and so
  on.
- **Component tests** use Testing Library in jsdom (new dev dependencies, see "Decisions").

### Core (a bug fix)

- **`canonicalSnapshot` rebuilds split entries with fixed keys** (see "Problems" 1).

No API, contract or database changes: the API has accepted every split and several payers since
Phase 7.

## Decisions and deviations

- **New dev dependencies, web only:** `@testing-library/react` 16.3.3, `@testing-library/dom`
  10.4.2, `@testing-library/user-event` 14.6.8 and `jsdom` 30.1.3.
  - They're in the workspace catalog.
  - `user-event` and `jsdom` are pinned exactly: their newer releases (14.6.9–10, 31.0.0) were
    under two weeks old.
  - Assertions use plain DOM checks rather than also adding `@testing-library/jest-dom`.
- **The sheet stays an inline panel on phones too,** as since Phase 7, not a nested drawer. The
  form is already full-screen on phones, and a drawer inside it would hide the amount and Save.
- **Only entries above zero are saved** (exact, percent, shares and payers). The sheet lists
  everyone, and a blank or 0 means "not in this one", so nothing changes when the same split is
  saved again.
- **Several payers use tick boxes** next to the amounts. "Split payment equally" then divides
  between the people ticked, which says who it's between without guessing from what was typed.
- **"Fill remainder" and "Assign remaining to…" are pickers:** they say who gets the rest.
- **Blank counts as 0** in the sheet: a person left empty isn't in the split.
- **Rounding note:** "₹33.33 each, and ₹0.01 more for 1 person", worded for any currency (the
  plan's example says "paisa").

## Problems found and fixed

1. **Saving an unchanged percent or shares expense made a new version.** It read "Asha edited it",
   with no change.
   - Cause: a split read back from Postgres serializes differently from the same split in a
     request. jsonb puts `bp` before `userId`; a request has `userId` first. The server decides
     "unchanged" by comparing the JSON text, and `canonicalSnapshot` sorted the entries but kept
     each one's key order.
   - Worse, the same cause made an idempotent retry of a percent or shares create get
     `ID_CONFLICT` instead of the stored expense.
   - Phase 7's UI only sent equal splits, so nothing hit it until now. The end-to-end test "saving
     it unchanged changes nothing" found it.
   - Fixed in core: every entry is rebuilt with fixed keys. A core test compares the serialized
     text, as the server does; the old test used `toEqual`, which ignores key order. An API test
     now replays and re-saves exact, percent and shares expenses with two payers.
2. **An end-to-end locator matched two buttons:** "Percentages" also matched the summary chip
   ("…Split by percentages"); it's exact now.
3. **Environment:** Playwright's Chromium vanished from `~/.cache/ms-playwright` again (the second
   time in two days). Nothing in this repo or any scheduled job found on the machine removes it.
   Reinstalled.

## Verification

- `pnpm check` passes, and `pnpm test --force`.

  | Package    | Tests     |
  | ---------- | --------- |
  | core       | 252       |
  | contracts  | 286       |
  | api-client | 63        |
  | db         | 97        |
  | api        | 322       |
  | web        | 123       |
  | **Total**  | **1,143** |

- **Split-draft unit tests (28):** every validation state of every method and of several payers;
  the body; round trips for each method with two payers (reopen, re-save the same split); a split
  saved without its input; percentages as typed; preview equals `computeShares` for several seeds;
  each shortcut; remembered defaults.
- **Component tests (9):** the real form in jsdom, driven like a person would:
  - equal split saved in one tap, and messages in form order;
  - the rounding note and "Split with everyone";
  - exact: what's left, too much, "Assign remaining to…", and the saved split;
  - percent: the ₹ beside each, a bad percentage, "Fill remainder";
  - shares: steppers, 0 leaves out, nobody refused;
  - two payers: what's left, "Split payment equally", "One person paid";
  - the shares shown are the shares sent;
  - an edit reopening a percent split with two payers, exactly as entered.
- **API integration:** exact, percent and shares with two payers, each saved as computed, replayed
  (200) and re-saved unchanged with entries in another order (no new version, no new activity).
- **Bug injection: 14 of 14 caught:**
  - exact accepting a mismatch; percent miscounting what's left; blank amounts unreadable; zero
    payers sent; percentages written wrongly; "assign remaining" going negative; remembering
    non-equal splits
  - (component) edits opening with the sheet closed; the description not asked for; "Fill
    remainder" doing nothing
  - (end-to-end) the edit ignoring the split input; the expense page losing its input view
  - (core, API) the old key-order behaviour, caught by both
- **End-to-end: 50 of 50** (25 tests × desktop and phone), no console errors. New:
  - a percent split: from the equal start, "5% left", "Fill remainder", saved, "30% · ₹300.00" on
    the expense page, the edit reopening at 50 / 30 / 20, and saving it unchanged leaving version 1
  - two payers: "Split payment equally", then 2,000 / 1,000, the balance (you're owed ₹1,000), and
    the edit reopening with both
  - ₹100 three ways: each person's amount shown in the form equals the saved share, to the paisa
- **Docker image:** migrations run (twice, idempotent), the smoke test passes, no error logs.
- **Screenshots reviewed** (phone): exact with what's left, percent, shares, two payers, the
  expense page's input view.

## Lined up next

**To finish Phase 11:**

1. **Commit and push** (nothing is committed). There are no new settings and no migrations.
   `pnpm-lock.yaml` changes (the test libraries); CI installs them as usual.
2. **Check on staging:**
   - Add an expense split by percentages and one by shares; open each and check the "input view".
   - Add one paid by two people with "Split payment equally".
   - Edit one of them: it reopens exactly as entered; save it unchanged, and its history shows no
     new line.

**Phase 12: rule-based natural-language parsing** (plan §11), after your go-ahead.

**Noted for later phases:**

- **Phase 12:** the parser's result fills this same draft (`draftFromExpense` / `evaluate`), so
  every split it understands gets the same checks.
- **v1.1:** a group's default split (such as 60/40), per Blueprint 7.3.
- **Phase 14:** the 114 kB shared chunk noted in Phase 7.
