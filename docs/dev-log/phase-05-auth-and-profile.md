# Phase 5: Authentication and profile

- **Dates:** 2026-11-12 (code, and live on staging the same day)
- **Status:** Done. Commit 8cd6544: CI green (including the new end-to-end job), deployed to
  staging, smoke test green (12 checks). On staging you signed in with an email code and with
  Google, and profile edits survived a reload.
- **Plan reference:** Implementation blueprint §4.1 (authentication), §6.1 and §6.3 (conventions,
  `/me`), §7.1 and §7.2 (layout, sign-in and settings screens), §9.1 (security), §10.5
  (end-to-end tests), §11 Phase 5; plan correction "The domain-user hook runs outside the auth
  library's DB transaction"

## Goal

Sign-in with an emailed code or Google, a FairShare user created on first sign-in, `GET` and
`PATCH /me`, the anonymization function account deletion will use, and on the web: the sign-in
screens, the signed-in route guard, the app layout (sidebar on desktop, bottom tabs on phones),
an empty Home, a settings page and a theme setting. Outcome: you can sign in on staging.

## What was built

### API (`apps/api/src/`)

| File                            | What it does                                                                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/auth/auth.ts`          | Better Auth: email codes (6 digits, 5 minutes, 3 tries, stored hashed), Google, 30-day rolling sessions, cookie prefix `fairshare`, per-email code limit, origin checks always on, logs to pino. `AuthGateway` wraps it |
| `modules/auth/require-user.ts`  | 401 `UNAUTHENTICATED` without a session; otherwise sets `c.var.user` and passes on a refreshed cookie                                                                                                                   |
| `modules/auth/domain-users.ts`  | The auth user → domain user link, cached in memory (bounded)                                                                                                                                                            |
| `modules/auth/sign-in-email.ts` | The code email (subject `123456 is your FairShare sign-in code`) and its sender: one retry, failures logged and reported                                                                                                |
| `modules/auth/routes.ts`        | `GET /api/v1/sign-in-options` (public): `{ google }`                                                                                                                                                                    |
| `modules/users/`                | `GET`/`PATCH /me`; `ensureDomainUser` (idempotent, race-safe); `anonymizeUser`; `defaults.ts`: the first name and default currency                                                                                      |
| `modules/currencies/`           | `GET /api/v1/currencies`: the seeded currencies, read once per process                                                                                                                                                  |
| `http/guards.ts`                | 64 KB body cap (413 `PAYLOAD_TOO_LARGE`); `protectMutations`: same `Origin` and JSON bodies for `/api/v1` writes (403 `ORIGIN_NOT_ALLOWED`)                                                                             |
| `http/request-context.ts`       | The request's ID and logger for code without a Hono context (Better Auth's callbacks), via `AsyncLocalStorage`                                                                                                          |
| `lib/email/`                    | `EmailSender` with Resend (HTTP API, idempotency key), Mailpit (its HTTP send API) and an in-memory outbox for tests                                                                                                    |
| `lib/rate-limit.ts`             | A fixed-window, in-memory limiter per key                                                                                                                                                                               |
| `lib/ids.ts`                    | `uuidv7()` for new rows                                                                                                                                                                                                 |
| `compose.ts`                    | The one wiring of config → services → app, used by `main.ts` and the integration tests                                                                                                                                  |
| `config/env.ts`                 | New: `APP_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`/`SECRET`, `RESEND_API_KEY`, `MAILPIT_URL`, `EMAIL_FROM`, `CLIENT_IP_HEADERS`. `loadDatabaseEnv` for the migration step                                                |
| `testing/integration.ts`        | `integrationApp()`: the real app on a fresh database with an outbox, plus `signIn`, `sendCode`, `latestCode`                                                                                                            |

How a first sign-in by email goes:

1. The browser posts the address to `/api/auth/email-otp/send-verification-otp`. Our hook checks
   the per-email limit (3 per 10 minutes), Better Auth checks the per-IP one, stores a hash of a
   new code and calls our sender.
2. The code is posted to `/api/auth/sign-in/email-otp`. Better Auth creates `auth_user` and
   `auth_session` and sets the cookie. After its transaction, the `user.create.after` hook creates
   the `users` row: name from the email, currency from the browser's region.
3. Every `/api/v1` request then goes through `requireUser`, which also creates the `users` row if
   the hook failed.

### Contracts and API client

- `SignInOptions`, `Currency`, `CurrencyList`.
- Error codes `ORIGIN_NOT_ALLOWED` (403) and `PAYLOAD_TOO_LARGE` (413).
- Client methods: `signInOptions()`, `currencies()`, `me()`, `updateMe()`.

### Web app (`apps/web/src/`)

- **Stack:** TanStack Router (file routes, code-split per page) and Query, Tailwind CSS 4 with
  light and dark tokens, React Hook Form with the zod resolver, `radix-ui`, lucide icons, Better
  Auth's browser client.
- **Routes:**
  - `/sign-in` (layout) with `/sign-in/` (email) and `/sign-in/verify` (code)
  - `_authed` (guard and layout) with `/`, `/activity` and `/settings`
- **Sign-in:**
  - The code input is one real input under six boxes: autofill, paste, numeric keypad, screen
    readers.
  - It submits by itself at 6 digits and shows tries left ("Code is incorrect (2 tries left).").
  - Resend after 60 seconds; "Code expired" and "Too many tries" offer a new code.
  - The address waits in session storage, never in the URL.
  - `returnTo` accepts only a path on this site.
  - Google is offered when the server has it configured.
- **App shell:** sidebar from 768px (navigation, empty Groups and People, the account link);
  below that a header with the avatar and a Home · Activity tab bar. Skeletons while loading.
- **Settings:** name, default currency (with currency names from `Intl`), UPI ID, theme
  (System/Light/Dark, saved on this device), sign out. Server validation errors land on their
  fields.
- **Theme:** `public/theme.js` applies it before the first paint. It's a file, not an inline
  script, because the CSP allows our own scripts only.
- **Errors:**
  - Any 401 from the API sends the user back to sign in, and then returns them to the same page.
  - API error codes get friendly copy from one dictionary (`lib/errors.ts`).
  - Unknown errors show the request ID.

### End-to-end tests (`e2e/`, new workspace package)

- Playwright runs the production build (`apps/api/dist` serving `apps/web/dist`) on its own
  database, `fairshare_e2e`, recreated each run, and reads codes from Mailpit's API.
- Chromium at desktop size and at Pixel 7 size.
- Every test fails on any browser console error, which catches CSP violations.

### CI, Docker and docs

- **CI:**
  - The image job passes the new variables.
  - A new **End-to-end** job runs with Postgres and Mailpit services, and uploads the Playwright
    report when it fails.
- **Smoke test:** four new checks:
  - the sign-in options answer
  - Better Auth answers with no session
  - `/api/v1/me` needs a session
  - a write from another site is refused

  The 404 check moved to a path outside `/api/v1`.

- **docker-compose:** Mailpit pinned to 1.33.
- **`.env.example`:** the sign-in section.
- **Docs:**
  - ARCHITECTURE: a "Sign-in and sessions" section, CSRF, the new pipeline steps, testing, and
    version decisions.
  - Runbook: new steps 3 (Resend) and 4 (Google), the Railway variables, and the Cloudflare
    follow-ups.
  - README.

## Decisions and deviations

- **Two endpoints the plan doesn't list:**
  - `GET /api/v1/sign-in-options` is public, so the sign-in page offers Google only when the
    server has it.
  - `GET /api/v1/currencies` exists because the currency picker needs the supported list, which
    lives in the database.
- **Two new error codes:** `ORIGIN_NOT_ALLOWED` (403) and `PAYLOAD_TOO_LARGE` (413), for the
  §9.1 measures that arrived this phase.
- **`__Secure-` instead of `__Host-`:** Better Auth always prefixes `__Secure-` and has no
  `__Host-` option. The cookie still has `__Host-`'s attributes (no `Domain`, `Path=/`, `Secure`
  over https).
- **No test-only outbox route:**
  - Integration tests read an in-memory outbox directly.
  - End-to-end tests read Mailpit, as a person would.
  - So nothing test-only is compiled into the server, and nothing needs compiling out.
- **Resend over SES:** an HTTP API with no SDK, a free tier, and a test sender for staging before
  there is a domain. Mailpit is used through its HTTP send API, so no SMTP library is needed.
- **A failed code email still answers "sent":** that's Better Auth's design. The sender retries
  once, then logs and reports to Sentry. The person can resend after 60 seconds.
- **The sign-in response body carries the session token:** Better Auth includes it for clients
  that use bearer tokens. The cookie itself is httpOnly. Noted for the Phase 13 hardening pass.
- **Rate limits:**
  - Ours: 3 codes per address per 10 minutes.
  - Better Auth's, in production: 3 requests a minute per IP and path for sending and checking
    codes.
  - The IP comes from `X-Real-IP`, Railway's documented header. Without it, Better Auth would put
    every visitor into one shared bucket.
  - A Railway forum thread reports that this header sometimes carried an infrastructure address
    instead of the visitor's. If staging shows that, set `CLIENT_IP_HEADERS` accordingly.
- **Default currency:** taken from the browser's region only ("en-GB" → GBP). A language without a
  region ("en") falls back to INR rather than guessing the US.
- **Google picture:** set when the account is created. Linking Google to an existing email-code
  account doesn't add the picture yet.
- **No guessing route names:** an unknown `/api/v1` path answers 401 before 404, so routes can't
  be probed without signing in.
- **JSON-only writes:** a non-JSON body on `/api/v1` writes is now rejected. Phase 4's "read as
  `{}`" behaviour would have turned a form post to `PATCH /me` into a silent no-op.
- **Migrations need only database settings:** `loadDatabaseEnv`, so the pre-deploy step doesn't
  need the auth secrets.
- **Request log lines carry the user ID** once `requireUser` has run.
- **Home has no "＋ Expense" button yet,** nor actions on the empty-state cards, until groups and
  expenses exist (Phases 6–7). There are no dead buttons; Activity shows its empty state.
- **Better Auth's origin checks are on in tests too** (`disableOriginCheck: false`). Under
  `NODE_ENV=test` Better Auth turns them off unless told otherwise.
- **Hand-written shadcn components,** and relative imports instead of an `@/` alias, matching the
  rest of the repo.
- **End-to-end tests run in Chromium only for now** (desktop and phone sizes). WebKit needs extra
  system packages; it's noted for Phase 14.
- **Sizes:** the main bundle is 408 kB (131 kB gzipped), up from 307 kB, because the router, query
  library, forms and auth client arrived. Pages are split into their own chunks. The Docker image
  is 377 MB, up from 272 MB, because of Better Auth's dependencies.

## Problems found and fixed

1. **The callback check was off in tests.** A Google callback URL on another site was accepted in
   a test, because Better Auth skips origin checks when `NODE_ENV=test`. Production was never
   affected; the checks are now on explicitly, so the tests run what production runs.
2. **Parallel test runs dropped each other's database.** The API's tests now use Postgres too, and
   turbo runs the db and api packages at the same time. Both setups dropped and recreated the
   same template database with `FORCE`, cutting the other's connections ("Connection terminated
   unexpectedly"). Each package now names its own template (`TEST_TEMPLATE_DATABASE`).
3. **The race test raced nothing.** Bug injection showed it passed without the
   `ON CONFLICT DO NOTHING` guard: the first call finished before the pool opened its other
   connections. The test now opens them first, and it fails without the guard every time (3 of 3
   runs) and passes with it every time (5 of 5).
4. **The request log line lacked the user ID,** because the summary used the logger from the start
   of the request. It now uses the request's final logger.
5. **Smaller ones:**
   - the outbox lookup in the tests was case-sensitive
   - the profile form's name messages came from the shared schema
   - a form schema and its component shared a name
   - TanStack's `throw redirect()` needed a scoped lint exception
   - a layout test assumed a hidden element is still in the accessibility tree

## Verification

- `pnpm check` passes: format, lint, typecheck and tests.

  | Package    | Tests   |
  | ---------- | ------- |
  | core       | 247     |
  | contracts  | 280     |
  | api-client | 29      |
  | db         | 97      |
  | api        | 138     |
  | web        | 9       |
  | **Total**  | **800** |

- **API integration tests** (real Better Auth, real Postgres) cover:
  - the code email
  - codes stored hashed
  - a new code replacing the old one
  - the per-email limit with `Retry-After`
  - the cookie's attributes over http and https
  - the domain user's name and currency
  - one user per person, case-insensitive
  - 3 wrong tries then locked
  - one use per code
  - expiry
  - no code or address in the logs
  - 401 without a session
  - sign-out deleting the session
  - a cross-site sign-out refused
  - Google offered only when configured, its redirect URI, and a foreign callback refused
  - `PATCH /me` (fields, nulls, an unsupported currency, invalid values, Origin)
  - the currencies list
  - concurrent user creation
  - Google picture rules
  - anonymization
  - the seeded Asha and Bilal signing in as their seeded users
- **Bug injection: 18/18 caught.** Each change was applied alone, the relevant tests run, the file
  restored:
  - no Origin check
  - form posts allowed
  - body cap raised
  - no per-email limit
  - codes stored in plain text
  - 5 tries per code
  - 7-day sessions
  - callback origin check off
  - refreshed cookie dropped
  - Google always offered
  - unsupported currency accepted
  - http picture accepted
  - anonymization keeping the auth user
  - no conflict guard
  - q-values ignored
  - CSP blocking Google pictures
  - `returnTo` allowing `//host`
  - `returnTo` allowing a sign-in loop
- **End-to-end: 12/12** (6 tests × desktop and phone), with no console errors:
  - sign-up lands on Home
  - sign-in returns to the page that asked
  - profile edits survive a reload
  - sign-out
  - an invalid UPI ID
  - the tries countdown
  - the theme survives a reload
  - the layout for each screen size
- **Screenshots reviewed:** sign-in, code entry with an error, Home, settings; desktop and phone;
  light and dark.
- **Docker image, locally:**
  - The migration runs with only `DATABASE_URL`.
  - Without `AUTH_SECRET` the server refuses to start and names it.
  - The smoke test passes 12/12.
  - A code requested from the image arrived in Mailpit.
- **`pnpm dev`:** through Vite's proxy, a write with the app's Origin reaches the API (401, as no
  session), another Origin gets 403, and Better Auth answers.

## Lined up next

**Phase 6: groups, members, friends and invites** (plan §11), started 2026-11-12.

**Noted for later phases:**

- **Phase 6:**
  - Offer to claim placeholders whose email hint matches the verified email (a plan correction).
    `ensureDomainUser` is the place to hook it in.
  - Radix Dialog and Drawer lock scrolling by injecting a `<style>` element, which the CSP
    (`style-src` falls back to `'self'`) may block. The end-to-end console check will show it;
    the fix would be a CSP nonce or hash for styles.
- **Phase 13:**
  - `DELETE /me` on top of `anonymizeUser`, plus leaving settled direct groups and the activity
    entries.
  - Consider stripping the session token from Better Auth's sign-in response.
  - The API rate limiter (120 requests a minute).
- **Phase 14:**
  - Publish the Google app.
  - Verify a domain in Resend.
  - WebKit end-to-end tests.
  - The bundle size.
- Add the Google picture when Google is linked to an existing email-code account.
- Locally, Mailpit collects the end-to-end tests' emails, and `fairshare_e2e` stays in the local
  Postgres between runs (it's recreated each run).
