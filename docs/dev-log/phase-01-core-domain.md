# Phase 1: Core domain logic

- **Dates:** 2026-11-07
- **Status:** Done
- **Plan reference:** Implementation blueprint §4.5–4.7, §4.9, §9.2, §10.2–10.3, §11 Phase 1

## Goal

A fully tested, dependency-free financial engine in `packages/core` that can replay the plan's Goa
example. Gate: 100% coverage, property tests running 1,000+ cases each.

## What was built

All code is pure TypeScript with zero dependencies. It compiles without Node or DOM types, so it
can't do I/O, read the clock or use randomness.

| Module     | Files                                                                    | What it does                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| errors     | `errors.ts`                                                              | `DomainError` (bad input the user can fix, with a stable `code`) vs `InvariantViolation` (a bug)                                                                                                      |
| money      | `money/constants.ts`, `amount.ts`, `decimal.ts`, `parse.ts`, `format.ts` | `parseMoney`, `tryParseMoney`, `parsePercent`, `formatMoney`, `toDecimalString`, `isValidAmount`, `assertValidAmount`. No floats anywhere.                                                            |
| split      | `split/hash.ts`, `allocate.ts`, `computeShares.ts`, `payers.ts`          | FNV-1a seed hash; `allocateProportional` (BigInt, canonical order, largest remainder, seeded rotation); `computeShares` for equal / exact / percent / shares; `validatePayers`; `splitPaymentEqually` |
| ledger     | `ledger/types.ts`, `ledger.ts`                                           | `ledgerLines` (paid − share), `netsFromTransactions` (per currency, checks I6), `settlementLines`                                                                                                     |
| simplify   | `simplify/simplify.ts`                                                   | Greedy debt simplification with deterministic tie-breaks                                                                                                                                              |
| invariants | `invariants/invariant.ts`, `transaction.ts`                              | `invariant()`, `assertTransactionInvariants` (I1, I2, I3, I9, I10), `assertNetsSumToZero` (I6)                                                                                                        |
| activity   | `activity/diff.ts`                                                       | `TransactionSnapshot`, `canonicalSnapshot`, `diffSnapshots` (structured field changes)                                                                                                                |

Public API: [packages/core/src/index.ts](../../packages/core/src/index.ts). Source: ~860 lines;
tests and generators: ~1,870 lines.

## Key behaviors

- **parseMoney** works on the string: `parseMoney("2,400.50", 2)` → `240050`. It accepts Western
  (`240,000`) and Indian (`2,40,000`) grouping, `.5` and `5.`, and surrounding whitespace. It rejects
  signs, symbols, exponents, `Infinity`/`NaN`, non-ASCII digits, misplaced commas, and more
  decimals than the currency allows (`"1.5"` in JPY). Amounts over the ₹10 crore cap are rejected
  with no precision loss on the way, because the check happens in BigInt.
- **Rounding:** ₹100 split three ways is 3,334 + 3,333 + 3,333 paise. The extra paisa goes to the
  largest remainder first, then rotates by `hash(transactionId)`, so nobody always pays it. The
  same transaction ID always gives the same result, so the browser preview equals what the server
  saves.
- **Goa example reproduced exactly:** balances A +₹1,850, B −₹950, C −₹150, D −₹750; suggested
  transfers B→A ₹950, D→A ₹750, C→A ₹150; after the settlement and the dinner edit, A +₹800,
  B +₹200, C −₹250, D −₹750.

## Decisions and deviations from the plan

| Topic                      | Plan                                                 | Implemented                                                                                                                                   | Why                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseMoney` signature     | `parseMoney("2,400.50", "INR")`                      | `parseMoney(input, minorUnits)`                                                                                                               | The plan also says core receives minor units as an argument and never reads the currencies table. The caller looks up the decimals.                                          |
| Grouping commas            | "strip grouping separators"                          | Commas must be in valid Western or Indian positions                                                                                           | `"2,50"` (a European decimal comma) would otherwise silently become ₹250 instead of ₹2.50                                                                                    |
| Zero in `parseMoney`       | Not specified                                        | Accepted                                                                                                                                      | An exact split can give someone ₹0. Whether an amount must be positive is the caller's rule (`assertValidAmount`).                                                           |
| `formatMoney`              | "takes Intl as an argument"                          | `formatMoney(amount, minorUnits, intl, { locale, currency? })`; the amount reaches Intl as an exact decimal string                            | No float division, ever. Without `currency` it prints digits only, which `parseMoney` reads back (a tested round trip).                                                      |
| Shares range               | Type comment says 1..1000; UI says "0 excludes them" | 0..1000, with 0 excluded                                                                                                                      | Matches §10.2 ("zero shares excluded") and the UI                                                                                                                            |
| Zero amounts               | "Shares stored only when > 0"                        | `computeShares` returns only positive shares; `allocateProportional` keeps zero lines                                                         | The low-level function stays complete for previews; the share rows stay valid                                                                                                |
| `splitPaymentEqually`      | Not specified for tiny totals                        | Leaves out payers whose part rounds to 0                                                                                                      | Payer rows must be > 0                                                                                                                                                       |
| Simplify complexity        | "O(n log n)"                                         | O(n²) worst case (linear re-insertion)                                                                                                        | n ≤ 50 members, so this is microseconds; the simpler code is easier to verify                                                                                                |
| Activity diffs             | "Rahul changed the amount…"                          | `diffSnapshots` returns structured changes; the web app writes the sentence                                                                   | Sentences need names, locale and currency formatting, which belong in the UI. `splitInput` isn't diffed separately because its effect shows in `splitMethod` and the shares. |
| Settlement builder         | Not in Phase 1's list                                | `settlementLines` added                                                                                                                       | Needed for the §10.2 ledger tests and reused by Phase 9                                                                                                                      |
| Error codes                | 422 list in §6.1                                     | Adds `INVALID_MONEY`, `INVALID_PERCENT`, `AMOUNT_OUT_OF_RANGE`, `NO_PARTICIPANTS`, `DUPLICATE_USER`, `INVALID_WEIGHT`, `SETTLEMENT_SAME_USER` | The plan's "422 when from = to" had no named code. **Phase 2 contracts must include these.**                                                                                 |
| Rule parser, name resolver | Listed under core                                    | Not built                                                                                                                                     | The plan defers them to Phase 12                                                                                                                                             |

## Problems found and fixed

- **Two mistakes in my own test data**, both caught by the tests: an Indian-grouped amount
  (₹12,34,56,789.99) that exceeds the cap, and a hand-computed large-weight allocation. The code
  was right; the expectations were corrected.
- **Typecheck caught test-only type errors** that Vitest doesn't check. Fixing one led to a better
  design: `formatMoney` now accepts any `IntlLike` formatter (the global `Intl` satisfies it), so
  tests can verify the exact string handed to Intl.
- **100% branch coverage without dead code:** "can't happen" checks go through one tested
  `invariant()` helper instead of inline branches that no test could reach.

## Verification

- **247 tests in core** (17 files): 231 unit and example tests plus 16 property tests.
- **16 property tests × 1,000 runs** (fast-check). A temporary probe asserted exactly 1,000 runs per
  property. They cover: shares sum to the total; determinism and order independence; every share
  within 1 minor unit of its exact proportional value; every built transaction passes its
  invariants with a ledger summing to 0; nets sum to 0 after random sequences of up to 25
  create/settle/edit/delete/restore operations in INR and USD; edit-then-revert and delete-then-
  restore give identical balances; settling every suggested transfer zeroes the group; simplify
  settles exactly with ≤ n − 1 positive transfers and is order-independent; parseMoney ∘ formatMoney
  and parseMoney ∘ toDecimalString round trips; parseMoney on any random string returns a valid
  amount or a DomainError.
- **Coverage: 100%** statements (288), branches (152), functions (80) and lines (236). The gate is
  enforced in `vitest.config.ts`; a temporary untested function failed the run with exit code 1.
- **Mutation check: 6 of 6 injected bugs caught.** Leftover paise never distributed (22 tests
  failed), seed ignored (2), smallest remainder favored (3), simplify using max instead of min (7),
  canonical ordering removed (5), shares added instead of subtracted (17). The originals were
  restored and diff-verified.
- **Whole repo:** frozen-lockfile install, format check, lint, typecheck, test and build: 20/20
  Turbo tasks pass; 264 tests across all packages.

## Files

- Added: `packages/core/src/{errors,types}.ts`, `money/{amount,decimal,parse,format}.ts`,
  `split/{hash,allocate,computeShares,payers}.ts`, `ledger/{types,ledger}.ts`,
  `simplify/simplify.ts`, `invariants/{invariant,transaction}.ts`, `activity/diff.ts`, the tests
  next to each, `testing/{arbitraries,goa}.ts`, `packages/core/vitest.config.ts`.
- Changed: `packages/core/package.json` (fast-check, coverage, `test` runs with `--coverage`),
  `pnpm-workspace.yaml` (catalog entries), `packages/config/eslint.js` (test generators in
  `src/testing/` may import test tools), `packages/core/src/index.ts`.

## Not committed

Per instruction, nothing is committed or pushed until explicitly requested.

## Next

Phase 2: contracts and api-client. zod schemas for Money, SplitInput, CreateExpense,
CreateSettlement (including the settlement field mapping noted in ARCHITECTURE.md), Transaction,
Group, Member, Balances, ActivityEntry, pagination, the error envelope with every error code (now
including core's), ParseResult; JSON Schema generation for the LLM extraction schema; and the
api-client's If-Match support.
