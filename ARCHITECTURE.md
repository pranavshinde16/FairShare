# FairShare architecture

FairShare is a shared IOU ledger: log an expense, see who owes whom, settle up. This document holds
the rules that keep the codebase and the money correct. Read it before changing package boundaries
or anything that touches amounts.

## Principles

- **Store facts, derive balances.** The source of truth is transactions, their payers and their
  shares. Balances, simplified debts and friend totals are computed on read and never stored, so
  edits, deletes and restores can't make balances drift.
- **Settlements are transactions.** A settlement is one payer and one share, so there is one ledger
  and one edit/delete/restore path.
- **A friendship is a two-person group** (`kind = 'direct'`). No parallel code path.
- **Money is integers.** Amounts are safe-integer `number`s in minor units (paise), capped at
  `MAX_AMOUNT_MINOR` (10¹⁰). `BigInt` is used only inside allocation math. Floats never touch money.
- **AI only drafts input.** It never writes to the ledger; the user always saves through the normal
  form.
- **Boring stack.** One TypeScript monorepo, one API process, PostgreSQL. No microservices.

## Layout

```text
apps/web            React SPA (Vite, TanStack Router and Query, Tailwind). The API serves its build.
apps/api            Hono REST API: routes → service → repo per module.
packages/core       Pure domain logic. Zero dependencies.
packages/contracts  zod request/response schemas shared by every client and the API.
packages/db         Drizzle schema, SQL migrations, ledger view, seed.
packages/api-client Typed fetch wrapper built on contracts.
packages/config     Shared tsconfig presets and the ESLint config.
e2e                 Playwright tests against the production build.
```

Workspace packages export their TypeScript source directly (no per-package build step). Vite
compiles them for the web app and tsup bundles them into the API build.

## Dependency rules

These are enforced by `no-restricted-imports` in [packages/config/eslint.js](packages/config/eslint.js),
so a violation fails `pnpm lint` and CI.

| Package                 | May depend on                                              | Must not contain                                                      |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/core`         | nothing                                                    | I/O, zod, Drizzle, React, `Date.now()`, `new Date()`, `Math.random()` |
| `packages/contracts`    | `zod`, `@fairshare/core` (types)                           | Business rules beyond input shape (sums are core's job)               |
| `packages/db`           | `drizzle-orm`, `pg` (seed and tests also: core, contracts) | Feature queries (they live in each API module's `repo.ts`)            |
| `packages/api-client`   | `@fairshare/contracts`                                     | React hooks, database access                                          |
| `apps/web`              | api-client, contracts, core, Better Auth's browser client  | Server code: `@fairshare/db`, `pg`, `drizzle-orm`, `hono`             |
| `apps/api` `routes.ts`  | contracts, its service                                     | Business logic, SQL                                                   |
| `apps/api` `service.ts` | core, repos, activity helper                               | HTTP concerns                                                         |
| `apps/api` `repo.ts`    | db                                                         | Policy decisions, calculations                                        |

`packages/core` also compiles with no Node or DOM types, so `console`, `fetch` and `fs` are
unavailable to it by construction. Time and seeds are passed in as arguments.

## Errors

- **`DomainError`** (core): invalid input the user can fix, with a stable `code` such as
  `SPLIT_SUM_MISMATCH`. The API maps codes to HTTP statuses; the UI maps them to friendly copy.
- **`InvariantViolation`** (core): a broken internal guarantee. Always a bug: log it, alert on it,
  and show the user a generic error.

## API contracts

`packages/contracts` is the single definition of every request, response and error code.

- **Requests are strict** (unknown keys rejected). **Responses are lenient** (unknown keys dropped),
  so a tab running the previous build survives a deploy that adds a field. The value types mirrored
  from core (`Line`, `SplitInput`) are strict in both directions.
- **zod checks shape and per-field ranges; core checks rules** (sums, duplicates, settlement
  parties), so each rule has one error code.
- **Every error code has one HTTP status**, in `ERROR_HTTP_STATUS`. Core's `DomainErrorCode`s must
  all appear there; a type test fails the build otherwise.
- **Concurrency:** mutations of an existing transaction send `If-Match: "<version>"`
  (`formatIfMatch` / `parseIfMatch`). A stale version gets 409 `VERSION_CONFLICT` with
  `details.currentVersion`; a missing header gets 428 `IF_MATCH_REQUIRED`.
- The LLM's structured-output schema is generated from zod and committed under
  `packages/contracts/schemas/`, so changes to it are reviewed like code.

## API server

Every request passes through the same middleware, in this order (`apps/api/src/app.ts`):

1. **Request ID.** Taken from `X-Request-Id` when well formed, otherwise generated. It is echoed in
   the response header, bound to every log line and included in every error body.
2. **Request log.** One JSON line per request: method, path, status, duration. The query string is
   never logged, invite tokens in paths are replaced with `[token]`, and pino redacts `email`,
   `otp`, `token`, `cookie` and `authorization` wherever they appear in a logged object.
3. **Security headers.** A strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, connections
   only to ourselves and Sentry), HSTS, `nosniff`, `X-Frame-Options: DENY`,
   `Referrer-Policy: no-referrer`. No CORS headers: the web app is same-origin.
4. **Body-size cap** on `/api/*`: 64 KB, else 413 `PAYLOAD_TOO_LARGE`.
5. **Routes:**
   - `/api/health`: 200, or 503 when the database is down (the reason is logged).
   - `/api/auth/*`: Better Auth (see "Sign-in and sessions").
   - `/api/v1`: first `protectMutations` (below), then the public `GET /sign-in-options` and
     `GET /invites/:token`, then `requireUser`, then every other route. An unknown `/api/v1` path without a session is
     therefore 401, not 404, so route names can't be probed anonymously.
6. **Web app** (when `WEB_DIST_DIR` is set): static files, with `/assets/*` (content-hashed) cached
   for a year and everything else revalidated. A browser page load on any other non-API path gets
   `index.html`, for the client-side router. Missing files and API paths get the JSON 404.

**Errors** become responses in one place (`http/error-handler.ts`), always as the contracts
`ErrorEnvelope` with the request ID:

| Thrown                             | Response                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| `AppError(code, message, details)` | The code's status from `ERROR_HTTP_STATUS`                       |
| core's `DomainError`               | 422 with its code and details                                    |
| a zod error (from `validate()`)    | 400 `VALIDATION_FAILED`, with `details.issues[]`                 |
| malformed JSON                     | 400 `VALIDATION_FAILED`                                          |
| anything else                      | 500 `INTERNAL` with a generic message; logged and sent to Sentry |

Routes validate input with `validate(target, schema)` (`http/validate.ts`), which wraps
`@hono/zod-validator`.

**CSRF** (`http/guards.ts`, `protectMutations`): on `/api/v1`, any method other than GET, HEAD and
OPTIONS must carry `Origin: <APP_URL>` (403 `ORIGIN_NOT_ALLOWED` otherwise), and a body with a
Content-Type must be JSON (400 `VALIDATION_FAILED`), which an HTML form on another site can't
send. Session cookies are also `SameSite=Lax`. Better Auth applies its own origin checks to
`/api/auth/*`.

**Error tracking** (Sentry, both apps) is on only when a DSN is configured. Sentry 11 collects
cookies, headers, bodies, query strings, stack-frame variables and query parameters by default;
every one of those is switched off, since stack traces are all we need. The browser SDK is a
separate chunk, loaded only when configured.

## Sign-in and sessions

- **Better Auth 1.7** (`modules/auth/auth.ts`), mounted at `/api/auth/*`: email codes and Google.
  The rest of the API sees it only through `AuthGateway` (`handler`, `getSession`,
  `signInOptions`), so tests can use a fake.
- **Email codes:** 6 digits, valid 5 minutes, 3 tries, then locked; stored hashed. Limits: 3 codes
  per email address per 10 minutes (ours, `TOO_MANY_CODES`), plus Better Auth's per-IP limits in
  production (3 a minute per path). The client IP comes from `CLIENT_IP_HEADERS`
  (Railway: `x-real-ip`). Codes are sent inside the request with one retry. Better Auth reports
  success whatever the outcome, so a failed send is logged and sent to Sentry.
- **Sessions:** a server-side row (`auth_session`) and an httpOnly, `SameSite=Lax`, `Path=/`
  cookie named `fairshare.session_token`. Over https it is `Secure`, with the `__Secure-` prefix.
  Better Auth can't use the `__Host-` prefix, but the attributes are the same: no `Domain`,
  `Path=/`, `Secure`. 30 days, rolling: a session used at least once a day is extended, and
  `requireUser` passes the refreshed cookie on. Sign-out deletes the row.
- **Domain users** (C8): Better Auth owns `auth_*`. Each signed-in person also has a `users` row
  (UUIDv7), created on first sign-in. The name comes from Google, or else the email
  ("asha.kapoor@…" → "Asha Kapoor"); the default currency comes from the browser's region
  (`Accept-Language`), else INR. Better Auth's `user.create.after` hook runs after its own
  transaction and can fail on its own, so `requireUser` also ensures the row (idempotent,
  `ON CONFLICT DO NOTHING`), and caches the auth-user → domain-user link in memory.
- **Google:** an account with the same verified email links to the existing user. A callback URL is
  accepted only on `APP_URL`, and a failed Google sign-in returns to `/sign-in?error=…`.
- **Account deletion** (route in Phase 13): `anonymizeUser` keeps the `users` row as "Deleted user",
  clears its email, picture and UPI ID, and deletes the auth user, its sessions and linked accounts,
  in one transaction.
- **Web:** `/sign-in` → `/sign-in/verify` → `returnTo` (only a path on this site; see
  `safeReturnTo`). The `_authed` layout route checks the session before rendering, and any 401 from
  the API sends the user back to sign in.

## Groups, members and invites

- **Membership is the authorization primitive.** `requireMembership` guards every
  `/groups/:groupId/*` route: an active membership in a group that isn't deleted, or 404 (a
  malformed ID included), so group IDs can't be probed. A test matrix checks every group route
  for someone signed out, a stranger, a former member, a member and the owner.
- **Permissions** (`modules/groups/policies.ts`, pure): any member adds people, creates invites,
  renames; the owner removes members and deletes the group (403 `NOT_PERMITTED` otherwise).
  Removing, leaving and deleting need the person's (or everyone's) balance to be zero in every
  currency, read from the ledger view. When the owner leaves, the longest-standing member with an
  account becomes owner; with nobody left who can sign in, the group closes.
- **Friendships** are two-person groups (`kind = 'direct'`, one row per pair in `direct_pairs`,
  smaller UUID first) with no owner. They can't be renamed, left, deleted or given more members
  (422 `CANNOT_MODIFY_DIRECT_GROUP`), and take only an invite aimed at the placeholder friend.
  `POST /friends` finds or creates one; two racing requests end with one group, because the
  loser's `direct_pairs` insert fails and its transaction rolls back.
- **Adding people:** someone I share an active group with (by ID), or a new placeholder (a name,
  maybe an email). An email is only ever a hint on the placeholder, never matched against
  accounts: the person with that address sees it in `GET /claims` and claims it. So adding
  someone never reveals whether they have an account, and nobody joins a group without agreeing.
- **Invites:** 32 random bytes (base64url), of which only the SHA-256 is stored; valid 30 days,
  multi-use, revocable by their creator or the owner. The preview (`GET /invites/:token`) is
  public and limited to 30 a minute per IP. Accepting joins as a new member (or brings back a
  former one), or claims a placeholder.
- **Claiming** (`modules/claims/merge.ts`, Blueprint 5.3 with the corrections): lock the
  placeholder; abort with `MERGE_CONFLICT` if the claimer has any membership row in its groups;
  for a friendship with X where the claimer already has one with X, move the placeholder's
  transactions into theirs and close the duplicate; repoint memberships, payer and share rows;
  set `merged_into`; record `member.claimed`. The activity log is never rewritten.
- **Locks** are `FOR NO KEY UPDATE`: they queue writers on the same group or placeholder without
  blocking foreign-key checks from rows that merely reference it. Plain `FOR UPDATE` deadlocked
  two claims of one placeholder through two groups' invites.
- **Friend balances** (`modules/balances/pairwise.ts`): per group and currency, core's `simplify`
  turns the members' nets into transfers, and the ones between me and each person add up. They
  sum to my own nets, so screens can't disagree. `GET /friends` lists my friendships plus anyone
  I have a non-zero balance with.
- Every write records its activity entry in the same transaction (`recordActivity`).

## Deployment

- **One image** (`Dockerfile`): build web and API, then `pnpm deploy --prod` the API. tsup bundles
  the workspace packages into `dist/`, so the image holds only the bundle, its third-party
  dependencies, the web build and the migrations. It runs as the unprivileged `node` user.
- **Pre-deploy step:** `node dist/migrate.js` applies migrations and reference data with the owner
  role, over `MIGRATION_DATABASE_URL` (falling back to `DATABASE_URL`). It is idempotent. The
  server itself connects as a login role that is a member of `fairshare_app`.
- **Staging** runs on Railway with Neon Postgres in Singapore. Railway's service settings
  (Dockerfile build, pre-deploy migrations, health check, one replica) live in its dashboard and
  are listed in [docs/deploy-staging.md](docs/deploy-staging.md); Railway stopped reading
  `railway.json` (Config as Code is deprecated). Railway deploys `main` after CI passes, and
  `.github/workflows/staging-smoke.yml` smoke-tests each successful deploy. Because Railway's
  "Wait for CI" counts every Actions run on a commit, a failed smoke run also blocks redeploys of
  that commit until it is re-run (see the runbook).
- **Health check:** `/api/health` answers 503 when `SELECT 1` fails, and logs the Postgres error
  code and message (never the connection string) with the request ID.
- **Configuration** is environment variables validated at boot (`apps/api/src/config/env.ts`); the
  server refuses to start on a bad value. Browser values (`VITE_*`) are build arguments, because
  Vite bakes them into the bundle. They are public: never a secret.
- **CI** builds the image on every push, runs its migrations twice against a fresh Postgres, starts
  it and runs `scripts/smoke-test.sh`, the same check that runs against staging after a deploy.
  A separate job runs the end-to-end tests. One replica is required for now: the sign-in code
  limits (and the planned API rate limiter) keep their counts in memory.
- **Shutdown:** on SIGTERM the server stops accepting connections, finishes in-flight requests,
  closes the pool and flushes Sentry, or exits after 10 seconds regardless.

## Database

- **Migrations** live in `packages/db/migrations`. 0000 (extensions) and 0002–0003 are hand-written
  SQL; 0001 is generated from `src/schema` by drizzle-kit. `pnpm db:migrate` applies them and then
  upserts the reference data (currencies), so every environment has the same currencies.
- **Ledger checks at COMMIT:** deferred constraint triggers verify Σ payers = Σ shares = amount and
  the settlement shape. Violations raise `check_violation` with constraint `transaction_sums` or
  `settlement_shape`; `isLedgerInvariantError` recognizes them, and they always mean a bug.
- **Roles:** `fairshare_app` (the API) and `fairshare_readonly` (the nightly job) are NOLOGIN group
  roles created by migration 0003. Data is soft-deleted, so the app has DELETE only on payer/share
  rows, `direct_pairs` and Better Auth's tables, and only INSERT/SELECT on `activity_log`. Each
  environment's login user is made a member outside migrations. Locally the app connects as the
  owner, which bypasses grants (but not the append-only trigger).
- **Tests** run against real Postgres: one migrated template database per run, cloned per test file
  (`@fairshare/db/testing`). Each package that runs integration tests names its own template
  (`TEST_TEMPLATE_DATABASE`), because turbo runs packages' tests at the same time.
- **End-to-end tests** (`e2e/`, `pnpm e2e`) run the production build (`pnpm build` first) on its own
  database, in Chromium at desktop and phone sizes, reading sign-in codes from Mailpit. Any browser
  console error (a CSP violation, say) fails the test.

## Validation layers

1. Browser: React Hook Form + the contracts zod schema, for instant feedback.
2. API boundary: the same zod schema (strict objects, unknown keys rejected).
3. Core: semantic rules such as "shares sum to the total".
4. Database: CHECK constraints and a deferred trigger, as the last line of defense.

## Financial invariants

| #   | Invariant                                                                      | Enforced in                                   |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| I1  | Σ payers = transaction amount                                                  | core, DB deferred trigger, property tests     |
| I2  | Σ shares = transaction amount                                                  | core, DB deferred trigger, property tests     |
| I3  | Each transaction's ledger sums to 0 (follows from I1 + I2)                     | core, DB trigger, property tests              |
| I4  | Deleted transactions don't affect balances                                     | ledger view filter, integration tests         |
| I5  | Same input + same ID ⇒ identical shares; edit then revert ⇒ identical balances | core (seeded, canonical order), tests         |
| I6  | Group nets sum to 0 per currency                                               | core assert on read, nightly check            |
| I7  | Simplification preserves nets, uses ≤ n − 1 transfers, all amounts > 0         | core, property tests                          |
| I8  | Payers and participants are active members at write time                       | service, integration tests                    |
| I9  | Settlement: one payer, one share, equal amounts, from ≠ to                     | core, service, DB                             |
| I10 | Every amount is a positive safe integer ≤ cap, never fractional                | core, zod, DB CHECK                           |
| I11 | Activity is written for every financial mutation                               | service (same DB transaction), append-only DB |

The nightly invariant job looks for violations of I1–I3, I6 and I8. In a correct system its report
is always empty.

## Plan corrections

Issues found while reviewing the implementation plan, and the phase that resolves each.

| Issue                                                                                                                 | Resolution                                                                                                                                          | Phase |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| The sum trigger reads `NEW.transaction_id` on `transactions` rows, which errors in PL/pgSQL                           | **Done:** one function per kind of table, deferred to COMMIT, also on DELETE (migration 0002)                                                       | 3     |
| I9 has no database enforcement for settlements                                                                        | **Done:** the same trigger raises `settlement_shape` (migration 0002)                                                                               | 3     |
| `activity_log` is append-only, yet the merge rewrites `target_user`                                                   | **Done:** a trigger rejects UPDATE/DELETE, and the merge leaves `target_user` alone; readers resolve old IDs through `users.merged_into` (Phase 10) | 3, 6  |
| Settlement body (`note`, `reference`) doesn't map to `description`, `notes`, `payment_ref`                            | **Done:** `settlementColumns` / `settlementInput` in contracts; description is fixed "Settlement"                                                   | 2, 9  |
| The domain-user hook runs outside the auth library's DB transaction                                                   | **Done:** `requireUser` ensures the domain user exists (idempotent, cached)                                                                         | 5     |
| Invite tokens appear in URL paths                                                                                     | **Done:** request logs show `[token]`; `Referrer-Policy: no-referrer`; browser error reports are scrubbed (`lib/redact.ts`)                         | 4, 6  |
| Merge conflict check only considers active memberships                                                                | **Done:** any membership row, active or not, conflicts (and the primary key backs it up)                                                            | 6     |
| Ownership can pass to a placeholder when the owner leaves                                                             | **Done:** passes to the longest-standing active member with an account; with none left, the group closes                                            | 6     |
| Direct groups: "no invites" conflicts with "targeted claim link"; direct-group ownership is undefined                 | **Done:** a friendship has no owner and takes only invites aimed at its placeholder friend; it can't be renamed, left or deleted                    | 6     |
| The same person can exist as several placeholders                                                                     | **Done:** placeholders in different groups can each be claimed; two in the same group conflict, and the group removes one                           | 6     |
| Signing up with a placeholder's hinted email offers nothing                                                           | **Done:** `GET /claims` offers them; claiming is the same merge as an invite                                                                        | 6     |
| Adding someone by email adds their account directly: it reveals who has an account, and adds people without asking    | **Done:** adding by email always makes a placeholder with the email as its hint; the person is offered to claim it                                  | 6     |
| Activity snapshots omit a settlement's `paymentMethod` / `paymentRef`, so changing only those leaves no visible diff  | Add both to core's `TransactionSnapshot` and `diffSnapshots`                                                                                        | 9     |
| The `groups.name` CHECK (`kind = 'direct' OR length(name) BETWEEN 1 AND 60`) accepts a regular group with a NULL name | **Done:** explicit `name IS NOT NULL`, and direct groups must have no name                                                                          | 3     |
| Grants can't make `activity_log` append-only when the app connects as the table owner (the default on Neon)           | **Done:** an append-only trigger on top of the grants                                                                                               | 3     |
| ISO 4217 gives IDR 2 decimals, but CLDR/Intl formats it with 0                                                        | **Done:** IDR stored with 0 decimals; a test keeps every currency in step with Intl                                                                 | 3     |
| "Phase 2" means both post-MVP features and the Contracts phase                                                        | Post-MVP features are called **v1.1** in this repo                                                                                                  | —     |
| Library versions in the plan date from mid-2026                                                                       | Verified at install time; see "Version decisions"                                                                                                   | 0     |

## Version decisions

- **Node 24 LTS** (`.nvmrc`).
- **TypeScript 6.0.x**, not 7: `typescript-eslint` supports TypeScript < 6.1. Revisit when it
  supports 7.
- **pnpm 10**, pinned through `packageManager`. Dependency install scripts are blocked except those
  listed in `onlyBuiltDependencies`.
- Local Postgres runs on host port **5433** to avoid clashing with a system Postgres on 5432.
- **Drizzle ORM 0.45.x / drizzle-kit 0.31.x**, pinned to patch updates: v1 is still a release
  candidate. Revisit when 1.0 is stable.
- **Better Auth 1.7.x** (1.7.21; 1.8 is in beta). Its CLI is now the `auth` package
  (`@better-auth/cli` is deprecated).
- **Web:** TanStack Router 1.170 (file routes, generated `routeTree.gen.ts`, committed), TanStack
  Query 5, Tailwind CSS 4, React Hook Form 7 with `@hookform/resolvers` 7 (zod 4 support),
  `radix-ui` 1.8, lucide-react 1.x. The shadcn/ui components are written in the repo by hand in
  shadcn's style: its CLI's `init` rewrites the stylesheet and installs its own versions, bypassing
  the catalog.
- **Playwright 1.65**, Chromium only for now (desktop and Pixel 7 sizes).
- **Mailpit 1.33**, pinned: the API sends through its HTTP send API and the e2e tests read its
  search API.
- **Sentry 11** (`@sentry/node`, `@sentry/react`). v11 replaced `sendDefaultPii` with
  `dataCollection`, which defaults to collecting request data; we switch it all off.
- **pino 10** for logs, **@hono/zod-validator 0.9** for request validation (supports zod 4).
