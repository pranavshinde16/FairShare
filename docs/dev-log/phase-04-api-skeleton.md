# Phase 4: API skeleton and staging deploy

- **Dates:** 2026-11-10 (code part), 2026-11-11 (staging live), 2026-11-12 (fixes from going live)
- **Status:** Done (2026-11-12). Staging is live at https://fairshareapi-staging.up.railway.app,
  deploys `main` after CI, and passes the smoke test from a developer machine and on GitHub.
- **Plan reference:** Implementation blueprint §2 (backend, infrastructure), §3.3 (request flow),
  §6.1 (conventions, error format), §9.1 (security plan), §11 Phase 4

## Goal

The Hono app's request pipeline (request ID, pino logger with redaction, secure headers, the error
middleware, `/api/health`), static serving of the web build with an SPA fallback, a multi-stage
Dockerfile, Sentry on both apps, and a live staging URL that auto-deploys from `main` after CI, with
a smoke test after each deploy.

## What was built

### Request pipeline (`apps/api/src/`)

| File                      | What it does                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.ts`                  | `createApp(deps)`: request ID → request log → security headers → routes → web files → 404/SPA fallback, plus the error handler                         |
| `http/context.ts`         | `AppEnv`: the per-request `requestId` and `log`                                                                                                        |
| `http/errors.ts`          | `AppError(code, message, details)`. Its status comes from `ERROR_HTTP_STATUS`, so a code can't be sent with the wrong status                           |
| `http/error-handler.ts`   | `describeError` maps `AppError`, core's `DomainError`, zod errors and malformed JSON to the envelope; anything else is a logged, reported, generic 500 |
| `http/validate.ts`        | `validate(target, schema)`: `@hono/zod-validator` that throws, so failures become `VALIDATION_FAILED`                                                  |
| `http/request-logger.ts`  | One log line per request; `redactPath` replaces invite tokens with `[token]`                                                                           |
| `http/security.ts`        | The CSP and Hono's `secureHeaders` (HSTS, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`)                                            |
| `http/web.ts`             | `loadWebAssets` (fails at boot without `index.html`), `webFiles` (cache headers), `wantsAppPage` (the SPA fallback rule)                               |
| `observability/logger.ts` | `createLogger`: pino JSON lines, redacting `email`, `otp`, `token`, `cookie`, `authorization` up to three levels deep; pretty output in development    |
| `observability/sentry.ts` | `initSentry` (off without a DSN, all data collection off), `flushSentry`                                                                               |
| `config/env.ts`           | New variables: `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `WEB_DIST_DIR`. An empty value counts as unset                       |
| `main.ts`                 | Boot: env → logger → Sentry → pool → app → server; graceful SIGTERM shutdown (finish requests, close pool, flush Sentry, force exit after 10 s)        |
| `migrate.ts`              | The image's pre-deploy step, `node dist/migrate.js`                                                                                                    |
| `testing/app.ts`          | `testApp()` and `captureLogs()` for the tests                                                                                                          |

Every error body carries the request ID, so a user's report can be matched to the logs. The 404 for
unknown routes now carries it too.

### Web app

- `src/lib/sentry.ts`: browser error tracking, started only when the build has `VITE_SENTRY_DSN`.
  `main.tsx` loads it with a dynamic import, so Sentry (92 kB, 32 kB gzipped) is a separate chunk
  and never part of the main bundle. Uncaught render errors reach it through React 19's
  `window.reportError`.
- `src/vite-env.d.ts` types the two `VITE_*` variables.

### Deployment artifacts

- **`Dockerfile`**, multi-stage:
  1. `pnpm fetch` (a layer cached until the lockfile changes)
  2. offline install
  3. build web and API
  4. `pnpm deploy --prod --legacy` to prune the API's dependencies
  5. runtime: `node:24-alpine` with the API bundle, its eight runtime dependencies, the web build
     and the migrations, running as `node`

  272 MB in total; 124 MB of that is node_modules, mostly Sentry's OpenTelemetry packages.

- **`.dockerignore`**: `.env` and `.env.*` first, then build output, `.git`, docs.
- **`scripts/smoke-test.sh <base-url>`**: waits for health, then checks:
  - health is 200 with `db: up`
  - the request ID, CSP and HSTS headers
  - the web app at `/`
  - the SPA fallback
  - the JSON 404 for an unknown API path
- **CI**: a new `Docker image` job builds the image, runs its migrations twice against a fresh
  Postgres, starts it and runs the smoke test. It runs in parallel with the existing checks.

### Staging on Railway (host chosen 2026-11-10)

- **`railway.json`**, later deleted: Railway turned out not to read it (see "Going live on
  staging"). The same values are now set in the dashboard and listed in the runbook:
  - build from the Dockerfile
  - pre-deploy `node dist/migrate.js` (5-minute limit)
  - health check `/api/health` (2 minutes)
  - one replica, never sleeps
  - restart on failure (up to 5 times)
  - 15 s draining, longer than the server's own 10 s shutdown limit
- **`MIGRATION_DATABASE_URL`** (optional, defaults to `DATABASE_URL`). On Neon, migrations need
  the owner role over a direct connection, while the API connects as a limited role through the
  pooler.
- **`.github/workflows/staging-smoke.yml`**: on a successful GitHub deployment whose environment
  name contains "staging" (Railway reports deploys this way), or by hand, it runs
  `scripts/smoke-test.sh` against the `STAGING_URL` repository variable.
- **[docs/deploy-staging.md](../deploy-staging.md)**: the step-by-step account setup for GitHub,
  Neon, Sentry, Railway and Cloudflare, and how to check each.

### Other changes

- `apps/api/package.json`:
  - The workspace packages moved to devDependencies, because tsup bundles them.
  - Their third-party dependencies are now direct dependencies: `drizzle-orm` (needed by `migrate.js`) and `zod`. That is what `pnpm deploy --prod` installs.
  - `"files": ["dist"]`.
- `packages/db`: `runMigrations(url, migrationsFolder?)`, because the bundled caller's own location
  differs from the source's.
- `pool.ts` logs through pino instead of `console`.
- Catalog: `@hono/zod-validator`, `@sentry/node`, `@sentry/react`, `pino`, `pino-pretty`.
- `.env.example`, README (production build), ARCHITECTURE (new "API server" and "Deployment"
  sections, the invite-token plan correction, version decisions).

## Going live on staging (2026-11-11)

You did the account setup from the runbook. Staging came up healthy, but several things differed
from the runbook. All of them are now fixed in the runbook, and items 5 and 6 also in the repo.

1. **Neon's default branch is called `production`**, not `main`. `staging` was branched from it.
2. **`fairshare_app` already existed on `staging`**: the first connection strings pointed at the
   `production` branch, so the pre-deploy step migrated it (creating `fairshare_app` and
   `fairshare_readonly`), and `staging` was then branched from it. The runbook's
   `CREATE ROLE fairshare_app` failed there. The SQL is now safe to re-run: it creates each role
   only when missing, then sets the password and grants membership.
3. **Railway's monorepo detection** created two services, `@fairshare/api` and `@fairshare/web`,
   with `pnpm --filter` build commands and watch paths. You deleted the web service and cleared
   the root directory, build command, start command and watch paths, keeping the Dockerfile
   builder.
4. **Railway no longer reads `railway.json`.** Config as Code is deprecated: services that never
   used it can't opt in, and existing files stop being read on 2026-12-01. The pre-deploy command
   and health check path were set by hand in the dashboard. The runbook now lists every service
   setting with its value, since the dashboard is the only record.
5. **Wait for CI and the smoke test blocked each other.** Railway skips a deploy if any GitHub
   Actions run on the commit failed, and the smoke workflow runs on the commit it tests. Two smoke
   runs failed on d593b5e, so Railway skipped later deploys of that commit ("CI check suite
   failed"). The workaround was Deployments → ⋮ → Deploy commit.

   Both smoke runs had failed at "Check STAGING_URL is set", before the smoke script ran.
   `STAGING_URL` was saved as a repository **secret**, and the workflow reads it as a
   **variable**. The runbook now says which tab, and the workflow's error message names it too.
   The first deploy also went live with its database unreachable, because the health check wasn't
   configured yet (item 4). With the health check set, Railway fails such a deploy itself, so it
   never reaches the smoke test.

6. **`/api/health` answered 503 without saying why**, which made the database problem slow to
   find. `pingDatabase` now logs `database health check failed` with the error's code and message
   (for example `28P01` for a bad password), using the request's logger so the line carries the
   request ID. Only those two fields are logged. A connection string in the message is cut out,
   because some errors carry more: Node's `ERR_INVALID_URL` keeps the whole input URL, password
   included.
7. **Testing a `verify-full` string with psql** needs `&sslrootcert=system` added. That's for
   psql only (16 or later); node-postgres verifies against Node's own CA list.

The new runbook SQL was tested in a throwaway Postgres 17 container, with a `CREATEROLE` owner
standing in for `neondb_owner`. It worked both with `fairshare_app` already created by
migration 0003 and on an empty branch. A second run of each is a no-op apart from a NOTICE.

## Decisions and deviations

- **Sentry 11's data collection is all off.** Sentry 11 removed `sendDefaultPii`; its replacement,
  `dataCollection`, defaults to collecting cookies, headers, bodies, query strings, stack-frame
  local variables and database query parameters. Any of those can hold an email, OTP or session
  cookie. Every category is set off on both apps, and a test pins the settings.
- **Errors are captured explicitly.** The error handler reports 500s with the request ID as a tag;
  there is no performance tracing, so no Sentry auto-instrumentation is relied on.
- **The SPA fallback needs `Accept: text/html`.** Only browser page loads get `index.html`; a
  missing script or image still gets a 404, instead of HTML that would fail in a confusing way.
- **Cache policy:** `/assets/*` (content-hashed by Vite) `public, max-age=31536000, immutable`;
  `index.html` and everything else `no-cache`, so a deploy shows up on the next load.
- **Request IDs from the caller are accepted** when they're at most 255 characters of `[\w-=]`
  (Hono's rule), so the web client can correlate its own logs; anything else is replaced.
- **Invite tokens are redacted from request logs now**, in Phase 4 as the plan corrections table
  scheduled, because page loads of `/invite/<token>` already reach the API's log.
- **Browser `VITE_*` values are build arguments, not the root `.env`.** See problem 4.
- **Railway over Render**, chosen by you: it builds from the Dockerfile and runs a pre-deploy
  command, it can wait for CI before deploying, and the service doesn't sleep.
- **Region:** Singapore, the closest to India that both Railway and Neon offer, set in the
  dashboard.
- **The API's database user is created with SQL, not Neon's Roles page.** Roles created there join
  `neon_superuser`, which would override the grants from migration 0003.
- **`sslmode=verify-full`** in the Neon URLs. This node-postgres treats `require` as an alias for
  it and warns about it.
- **Railway settings stay in the dashboard, not in Railway's Infrastructure as Code.**
  `railway.json` is dead (see "Going live on staging"), and Railway's replacement is a
  `.railway/railway.ts` file applied with `railway config apply`, from your machine or from CI
  with a project token. It can't express the Dockerfile builder or path, watch paths, draining
  time, restart retries, sleep or Wait for CI, so the dashboard would still hold half the
  settings. It also needs a Railway token with write access in a public repository's CI, and in
  single-file mode a resource missing from the file is deleted. Revisit when production adds a
  second environment (Phase 14). `railway.json` is deleted, as you decided.
- **The smoke workflow keeps failing the commit's checks**, as you decided, so a failure still
  sends GitHub's email. With the health check set, a deploy that can't reach its database fails
  in Railway before the smoke test runs. If a failed smoke run blocks a redeploy, re-run it (the
  runbook's "Wait for CI" section). `continue-on-error` would avoid the block but lose the email.
- **Railway names:** the project is renamed `fairshare` (GitHub shows the environment as
  `fairshare / staging`). The service and its domain keep the generated
  `fairshareapi-staging.up.railway.app`, which the custom domain replaces later.
- **Deferred to Phase 5:** the 64 KB body cap and the `Origin` check for non-GET requests (§9.1).
  Both guard mutation endpoints, and the first one (with Better Auth's trusted origins) arrives in
  Phase 5. JSON-only already holds: a non-JSON body is read as `{}` and fails validation.

## Problems found and fixed

1. **Sentry 11 has no `sendDefaultPii`** (a type error). Reading its types showed the new
   `dataCollection` option and its permissive defaults, which led to the decision above.
2. **`serveStatic`'s `onFound` hook runs after the response is built**, so cache headers set there
   were lost. They're now set on the returned `Response`. On a miss the middleware returns Hono's
   context, not `undefined`; the first fix assumed otherwise and crashed (caught by the tests).
3. **zod 4's `z.ZodError` isn't an `Error`**, and Hono passes only `Error`s to `onError`, so a
   rebuilt `ZodError` escaped the handler. `validate()` throws `z.ZodRealError`, the class
   `safeParse` itself produces, which still matches `instanceof z.ZodError`.
4. **Pointing Vite's `envDir` at the root `.env` shipped React's development build** (515 kB
   instead of 307 kB), because that file sets `NODE_ENV=development` and Vite applies it. Found by
   attributing bundle bytes with the sourcemap. `envDir` was reverted. The main bundle is back to
   307 kB (94 kB gzipped), unchanged from before this phase.
5. **A test sent a newline in a request header**, which `fetch` itself rejects. The forged ID now
   uses spaces and braces, which Hono's ID rule rejects.

## Verification

- `pnpm check`: format, lint, typecheck and all tests pass.

  | Package    | Tests   |
  | ---------- | ------- |
  | core       | 247     |
  | contracts  | 275     |
  | api-client | 25      |
  | db         | 97      |
  | api        | 50      |
  | **Total**  | **694** |

  The coverage gates are unchanged.

- **API tests (50)** cover:
  - health (200 and 503), and the logged reason for a 503: code and message only, with the
    request ID, no connection string
  - request IDs (generated, kept, replaced)
  - the exact security headers on success and error responses
  - each row of the error mapping, and the 500 path (generic message, logged, reported once)
  - client errors are not reported
  - log redaction, and that the query string and invite tokens stay out of the log
  - static serving, cache headers, the SPA fallback and its limits, path traversal
  - the Sentry settings, and the env rules (including the migration URL)
- **Bug injection: 13/13 caught.** Each change was applied alone, the API tests run, the file restored:
  - envelope without `requestId`
  - `DomainError` sent as 400
  - 500s not reported
  - 500 leaks the real message
  - CSP allows framing
  - SPA fallback ignores `Accept`
  - SPA fallback covers `/api`
  - assets not cached
  - no log redaction
  - query string logged
  - invite token logged
  - Sentry collects request data
  - empty env var not treated as unset
- **Local production run** (`node dist/main.js` with `WEB_DIST_DIR`):
  - health 200
  - `/` and `/groups/123` serve `index.html` with `no-cache`
  - the asset has immutable caching
  - a missing asset and an unknown API path get the JSON 404
  - JSON log lines
  - clean SIGTERM shutdown
- **Docker image, locally:**
  - `docker build` succeeds.
  - `node dist/migrate.js` twice against a fresh database (the second run was a no-op; 34
    currencies, 4 migrations recorded).
  - The smoke test passes 8/8.
  - `docker stop` exits 0 in 0.14 s.
  - Pointed at a database that doesn't exist, the smoke test fails as it should: 503 and
    `db: down`, exit 1.
- `pnpm dev` still works, with pretty-printed logs.
- **Bug injection for the health logging: 3/3 caught** (connection string not scrubbed, no log
  line, whole error object logged).
- **Staging** (2026-11-12): `scripts/smoke-test.sh https://fairshareapi-staging.up.railway.app`
  passes 8/8 from a developer machine, and the two re-run "Staging smoke test" runs on GitHub
  pass 8/8. The browser Sentry test error arrived in `fairshare-web`. The service settings match
  the runbook's table, and Wait for CI is on.

## Lined up next

**Phase 5: authentication and profile** (plan §11, about a week), only after your go-ahead:

- Better Auth with email OTP and Google sign-in, the Drizzle adapter, cookie settings, trusted
  origins and rate limits; an email sender (Resend or SES, Mailpit locally, a test outbox).
- The `user.create.after` hook that creates the domain user; auth middleware that attaches it to
  the request; `GET`/`PATCH /me`, and the anonymization function that `DELETE /me` will use in
  Phase 13.
- Web: the Better Auth client, `/sign-in` and `/sign-in/verify`, the signed-in route guard, and an
  empty Home in the app layout (bottom tabs on mobile, sidebar on desktop) with a theme toggle.
- From this phase's notes: the 64 KB body cap, the `Origin` check on non-GET requests, and an
  `img-src` CSP entry for Google avatars.
- New account setup for you: a Google OAuth client and an email-sending account, plus their
  secrets in Railway.
- Outcome: you can sign in on staging with email OTP or Google.

**Noted for later phases:**

- Phase 14: the Neon `production` branch already has the schema, the reference data and the
  `fairshare_app`/`fairshare_readonly` roles from an early staging deploy (no user data). Decide
  then whether to use it as is or start it fresh. Also decide then whether Railway's
  Infrastructure as Code is worth adopting for two environments.

- Phase 5: body-size cap (64 KB) and the `Origin` check on non-GET requests; Better Auth mounted at
  `/api/auth/*`; Google avatars will need an `img-src` entry in the CSP.
- Phase 6: scrub invite tokens from browser error reports (the page URL), as the server logs
  already do.
- Phase 14: the main bundle is 307 kB (94 kB gzipped), mostly React and zod; worth a look at
  zod/mini or route-level code splitting during polish.
- Sentry source-map upload needs an auth token in CI; until then, stack traces from the minified
  web bundle are harder to read. Server traces are fine (`--enable-source-maps`).
