# Phase 2: Contracts and API client

- **Dates:** 2026-11-07
- **Status:** Done
- **Plan reference:** Implementation blueprint §6 (API design), §4.1–4.9 (field rules), §5.2
  (column limits), §8.5–8.6 (AI schemas), §11 Phase 2

## Goal

One definition of every API shape, in `packages/contracts`, shared by the web app, the API and any
future client. The API client gets a fetch wrapper with cookies, a typed `ApiError` and If-Match
support. Gate: schema unit tests with valid and invalid fixtures.

## What was built

### `packages/contracts`

| File              | Contents                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primitives.ts`   | `Uuid`, `CurrencyCode`, `IsoDate`, `Timestamp` (UTC only), `Amount` (1..cap), `SignedAmount`, `Money`, `Line`, `NetLine`, `Version`, `PersonName`, `Email`, `OccurredOn`, `latestOccurredOn`    |
| `errors.ts`       | `ERROR_HTTP_STATUS` (every code → status), `ErrorCode`, `ErrorEnvelope`, `ValidationFailedDetails` + `toValidationDetails`, `VersionConflictDetails`, `SumMismatchDetails`                      |
| `concurrency.ts`  | `formatIfMatch(3)` → `"3"`, `parseIfMatch(header)` → version or null                                                                                                                            |
| `pagination.ts`   | `PageQuery` (cursor, limit 1–100, default 30), `Cursor` (base64url), `page(item)` → `{ items, nextCursor }`                                                                                     |
| `users.ts`        | `UserRef`, `Profile`, `UpdateProfile` (UPI ID pattern from the plan), `DeleteAccount`                                                                                                           |
| `groups.ts`       | `NewMember` (user or placeholder), `CreateGroup`, `UpdateGroup`, `AddMember`, `Member`, `Group` (regular or direct), `GroupList`, `GroupEmoji`                                                  |
| `invites.ts`      | `InviteToken`, `CreateInvite`, `InviteCreated`, `InvitePreview`, `AcceptInvite`, `AcceptInviteResponse`                                                                                         |
| `friends.ts`      | `AddFriend`, `AddFriendResponse`, `Friend`, `FriendList`, `FriendDetail`                                                                                                                        |
| `home.ts`         | `Home`                                                                                                                                                                                          |
| `split.ts`        | `SplitMethod`, `SplitInput` (core's union, with per-entry ranges), `MAX_PEOPLE_PER_TRANSACTION = 50`                                                                                            |
| `transactions.ts` | `CreateExpense`, `UpdateExpense`, `CreateSettlement`, `UpdateSettlement`, `settlementColumns` / `settlementInput`, `Transaction` (expense or settlement), `TransactionListQuery`, pages, delete |
| `balances.ts`     | `Transfer`, `Balances`, `CurrencyTransfer`, `GroupBalances`                                                                                                                                     |
| `activity.ts`     | `ActivityVerb`, `EntityType`, `TransactionSnapshot`, `ActivityEntry`, `ActivityFeed`, `TransactionHistory`                                                                                      |
| `ai.ts`           | `LlmExpenseExtraction` + `llmExpenseExtractionJsonSchema()`, `ParseExpenseRequest`, `ExpenseDraft`, `NameResolution`, `ParseIssue`, `ParseResult`                                               |

Every schema is exported with a same-named type, so `CreateExpense` is both the validator and the
TypeScript type. Limits come from core where core owns them (`MAX_AMOUNT_MINOR`,
`BASIS_POINTS_TOTAL`, `MAX_SHARES_PER_PERSON`), so the two can't disagree.

The generated JSON Schema for the LLM is committed at
[packages/contracts/schemas/llm-expense-extraction.schema.json](../../packages/contracts/schemas/llm-expense-extraction.schema.json).
A test compares it with the generator's output, so any change to what the model is asked for shows
up in review.

### `packages/api-client`

- `transport.ts`: `request(schema, path, options)` and `requestNoContent(path, options)`. Options:
  `method`, `query` (undefined and null are skipped), `body` (sent as JSON), `ifMatch` (sent as
  `If-Match: "<version>"`) and `signal`. Cookies are always included. Responses are validated
  against the schema.
- `errors.ts`: `ApiError.code` is now typed (`ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE'`).
  `toApiError` reads the envelope with the contracts schema. `conflictVersion(err)` returns the
  version to reload after a VERSION_CONFLICT.
- `client.ts`: `createApiClient` is built on the transport. It still has only `health()`: per the
  plan, typed methods arrive with their endpoints (Phases 5–12).

## Conventions established

- **Requests are strict.** Unknown keys in bodies and query strings are rejected, so a typo such as
  `?persn=` fails loudly instead of being silently ignored.
- **Responses are lenient.** Response objects drop unknown keys. If responses were strict too, a
  browser tab still running the previous build would reject every response as soon as a deploy
  added a field. The value types mirrored from core (`Line`,
  `SplitInput`) are closed and strict in both directions.
- **zod checks shape, core checks rules.** Sums, duplicate users, "paying yourself" and "at least
  one participant" stay in core, which reports them with specific codes. Tests assert that zod
  passes these cases through.
- **Union types replace "nullable unless".** `Transaction` is expense | settlement and `Group` is
  regular | direct, which encodes the DB CHECKs in the types. For example, a settlement's `payers`
  is a one-element tuple, so `tx.payers[0]` is safe without a check.

## Decisions and deviations from the plan

| Topic                                        | Plan                                                                   | Implemented                                                                                                                                                                                                 | Why                                                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settlement field mapping**                 | Body has `note`, `reference`, `method`; columns differ; no description | `note → notes`, `reference → payment_ref`, `method → payment_method`, `description = "Settlement"`. `settlementColumns` does the mapping, `settlementInput` reverses it, and a round-trip test covers both. | Resolves the plan correction listed for Phase 2. A fixed description doesn't go stale when names change; the UI writes "Bilal paid Asha" from the payer and share.         |
| New error codes                              | §6.1 table                                                             | Added `CURRENCY_LOCKED` (409), `IF_MATCH_REQUIRED` (428), `PLACEHOLDER_UNAVAILABLE` (422), and core's 7 new codes (422)                                                                                     | The plan names these situations ("409 if changing currency…", "422 if the target isn't an unclaimed placeholder") without codes. A missing If-Match needed a distinct one. |
| Unknown error codes in the client            | Not specified                                                          | Become `INTERNAL`, keeping the server's message                                                                                                                                                             | `ApiError.code` stays an exact union the UI can switch on                                                                                                                  |
| `occurredOn` upper bound                     | 2000-01-01 to today + 365                                              | The schema checks the lower bound; `latestOccurredOn(today)` gives the upper one, which the service applies                                                                                                 | "Today" depends on the clock and the user's time zone, which a static schema can't know                                                                                    |
| `Group.name`                                 | `name: string`                                                         | `string` for regular groups, `null` for direct ones                                                                                                                                                         | The DB stores no name for direct groups, and "You & Rahul" depends on who is viewing, so the UI derives it                                                                 |
| `Friend.directGroupId`, `Home.people`        | Not nullable                                                           | Nullable                                                                                                                                                                                                    | The friend list includes people you only share regular groups with (§4.3), who have no direct group                                                                        |
| `me.owes` / `me.owed` in balances            | `Transfer[]`                                                           | Transfers with a `currency`                                                                                                                                                                                 | Outside a per-currency `Balances` entry, a transfer's currency would otherwise be lost                                                                                     |
| `ParseResult.resolutions`                    | One object with optional `userId` / `candidates`                       | A union on `status`; ambiguous needs ≥ 2 candidates                                                                                                                                                         | Invalid combinations (resolved without a userId) can't be expressed                                                                                                        |
| Parse issue codes                            | `'SPLIT_SUM_MISMATCH' \| 'AMOUNT_MISSING' \| 'PERCENT_SUM' \| ...`     | 8 named codes; `PERCENT_SUM` became `PERCENT_SUM_INVALID`                                                                                                                                                   | Same name as core's error. The list can grow in Phases 12 and 15.                                                                                                          |
| `LlmExpenseExtraction`                       | `z.object`, no limits                                                  | Strict, with length and item limits and field descriptions                                                                                                                                                  | §8.6 says strict. Limits bound the output size; descriptions guide the model.                                                                                              |
| `ActivityVerb`                               | `group.renamed` only                                                   | Added `group.updated` for emoji or currency changes                                                                                                                                                         | PATCH /groups can change more than the name                                                                                                                                |
| `UpdateProfile.upiVpa` / `UpdateGroup.emoji` | Optional                                                               | Also accept `null` to clear                                                                                                                                                                                 | Otherwise there's no way to remove them                                                                                                                                    |
| Emoji                                        | "emoji?"                                                               | Exactly one emoji (grapheme), including ZWJ sequences and flags                                                                                                                                             | Stops text or several emoji being stored as the group icon                                                                                                                 |
| Aborted requests                             | Phase 0 turned them into NETWORK_ERROR                                 | The AbortError is rethrown unchanged                                                                                                                                                                        | Callers (TanStack Query) need to tell cancellation apart from being offline                                                                                                |
| Coverage gate                                | 100% required for core only                                            | Also 100% for contracts and api-client                                                                                                                                                                      | Both now hold logic (If-Match parsing, the date window, the settlement mapping, error narrowing). The gate is cheap to keep.                                               |
| Payer uniqueness                             | Field table says "unique users"                                        | Checked by core (`DUPLICATE_USER`), not zod                                                                                                                                                                 | §6.3 says core checks uniqueness. One place means one error code.                                                                                                          |

## Problems found and fixed

- **The generated JSON Schema conflicted with Prettier.** Prettier would rewrap the file and the
  snapshot would never match. The `schemas/` folder is now in `.prettierignore`, because it's
  generated output.
- **Lint caught two test issues:** a type-only import, and `String(url)` on a value that could be a
  `Request`.
- **The shell defaulted to Node 23.** Verification was rerun on Node 24.22.2, matching `.nvmrc` and
  CI. Nothing changed, but the earlier run wasn't on the supported version.

## Verification

- **contracts: 275 tests** (11 files) and **api-client: 25 tests** (3 files), both at **100%**
  statement, branch, function and line coverage, with the gate enforced in each package's
  `vitest.config.ts`.
- **Valid and invalid fixtures for every schema.** The Goa example provides the valid ones. Invalid
  ones are "one field off" variants, and each test asserts the exact field path of the error.
- **Compile-time compatibility with core** (`compat.test.ts`, checked by `pnpm typecheck`):
  - `SplitInput`, `Line` and `TransactionSnapshot` are interchangeable with core's types.
  - core's `Transfer` and `CurrencyNets` fit the `Balances` response.
  - Every core `DomainErrorCode` is an `ErrorCode` mapped to 422. If core adds a code, the build
    fails until contracts handles it.
- **At runtime:** a parsed `CreateExpense` goes straight into `computeShares`, and a core snapshot
  survives JSON storage, parses back, and feeds `diffSnapshots`.
- **Bug-injection check: 8 of 8 caught.** The injected bugs were: CreateExpense not strict (4 tests
  failed), amount cap removed (2), If-Match upper bound removed (1), blank settlement note stored as
  `''` (1), settlement payers not a tuple (1, and typecheck fails), a core code mapped to 400 (1),
  If-Match header not sent (1), and unknown error codes not narrowed (1). The originals were
  restored and verified with an uncached run.
- **Whole repo on Node 24.22.2:** frozen-lockfile install, format check, lint, typecheck, test and
  build pass with Turbo's cache bypassed (20/20 tasks). 556 tests across all packages.

## Files

- Added in `packages/contracts/`: `src/{primitives,errors,concurrency,pagination,users,groups,invites,friends,home,split,transactions,balances,activity,ai}.ts`,
  their tests, `src/compat.test.ts`, `src/people.test.ts`, `src/testing/fixtures.ts`,
  `schemas/llm-expense-extraction.schema.json` and `vitest.config.ts`.
- Added in `packages/api-client/`: `src/transport.ts` and its test, `src/errors.test.ts`, and
  `vitest.config.ts`.
- Changed: `packages/contracts/src/index.ts`, `packages/api-client/src/{client,errors,index}.ts`
  and `client.test.ts`, both packages' `package.json` (`test` runs with `--coverage`;
  `@vitest/coverage-v8`), `.prettierignore`, and `pnpm-lock.yaml`.

## Notes for later phases

- **Phase 4:** the error middleware should use `ERROR_HTTP_STATUS` for statuses and
  `toValidationDetails` for zod errors. Return `IF_MATCH_REQUIRED` when `parseIfMatch` gives null.
- **Phase 7:** apply `latestOccurredOn(today)` in the expense service. Store blank notes as NULL, as
  `settlementColumns` already does for settlements.
- **Phase 9:** core's `TransactionSnapshot` has no `paymentMethod` or `paymentRef`, so changing
  only a settlement's method or reference wouldn't show in its history diff. Extend the snapshot
  and `diffSnapshots` when settlements land.
- **Phase 15:** some LLM providers' structured-output modes reject `maxLength` or `maxItems`. If the
  chosen provider does, strip those keywords when sending the schema; the zod validator still
  enforces the limits.

## Not committed

Per instruction, nothing is committed or pushed until explicitly requested.

## Next

Phase 3, the database (blueprint §5, §11 Phase 3):

- The Drizzle schema for every MVP table, plus Better Auth's tables.
- Migrations: tables, CHECK constraints and indexes; the ledger view and the deferred sum trigger
  (fixed per the plan corrections); role grants.
- A seed script with currencies and the Goa group.
- A `withTx` helper and an integration-test harness against the local Postgres.
