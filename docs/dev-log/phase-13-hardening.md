# Phase 13: Hardening and launch readiness

- **Dates:** 2026-11-13 (code part)
- **Status:** In progress. The code is done and verified locally (unit, integration, end-to-end,
  accessibility, Lighthouse, Docker image, a restore drill). It goes live with the next push; the
  nightly jobs need their settings first (see "Lined up next").
- **Plan reference:** §11 Phase 13; Blueprint 4.1 (account deletion), 7.1 (loading, errors,
  accessibility), 9.1 (security: rate limits, CSP, HSTS), 9.2 (nightly invariant job), 10.4
  (authorization matrix), C9 (offline), and "Backups" in the technology table

## Goal

Secure, installable and production-grade: account deletion, rate limits everywhere, the full
security headers, an installable app that opens offline, accessibility, every error worded, and a
database that's checked and backed up every night.

## What was built

### Account deletion

- **`DELETE /me`** with `{confirm: "DELETE"}` (the plan's contract, already in `contracts`), in one
  database transaction:
  - in each group: settled there, the person leaves (a friendship too); still owing or owed, they
    stay as "Deleted user", so the others can record what's paid back and the owner can then
    remove them;
  - an owner hands over to the longest-standing member with an account; with none left, the group
    closes (as when the last such member leaves);
  - a `member.deleted` entry in every group;
  - the person: "Deleted user", no email, picture or UPI ID, `deleted_at` set;
  - the auth user, sessions, linked accounts and any pending sign-in code deleted;
  - the response clears the browser's cookies and storage (`Clear-Site-Data`).
- **`UserRef.isDeleted`.** Deleted accounts are left out of new expenses (the default split, the
  split sheet, typed entry) but stay in settle-up; they're never offered to add (`GET /people`),
  never made a group's owner, and a friend's page offers no "Add expense" for them.
- **The screen** (`/settings/delete-account`, from Settings): what happens, every balance not yet
  settled (from Home), a checkbox to confirm, then sign-in with "Your account was deleted."
- **Activity:** "A member deleted their account" (the name is already "Deleted user"), with the new
  owner if there is one; "Your friend deleted their account" in a friendship.

### Rate limits on every route group

| Route group                           | Limit                                                       |
| ------------------------------------- | ----------------------------------------------------------- |
| Every signed-in `/api/v1` route       | 120 a minute per user (new)                                 |
| `/api/health`, `GET /sign-in-options` | 60 a minute per client IP, together (new)                   |
| `GET /invites/:token`                 | 30 a minute per client IP (Phase 6)                         |
| `/api/auth/*`                         | Better Auth's per-IP limits, now set explicitly (see below) |
| Sign-in codes                         | 3 per email per 10 minutes (Phase 5)                        |

429 `RATE_LIMITED` with `Retry-After`; one `rateLimit()` middleware for all of them.

### Security headers

The CSP gained explicit `style-src`, `worker-src`, `manifest-src` and `frame-src 'none'`; HSTS is a
year with subdomains (was 180 days); a Permissions-Policy turns off camera, microphone, location,
payment, USB, serial and Bluetooth. The end-to-end tests now report every
`securitypolicyviolation` event, not only what the browser logs, with the script and line.

### Installable app and offline

- `vite-plugin-pwa` 2.0 (`generateSW`): a manifest; "any" and "maskable" icons plus an Apple touch
  icon, rendered from SVG with Playwright's Chromium (`e2e/scripts/render-icons.ts`, no image
  library added); the app shell precached, **API responses never cached**.
- Any app address opens offline from the cache. A new version waits for "Reload" in a prompt, and is
  checked for hourly.
- **Offline:** a banner ("You're offline. Saving is off until you're back online."), every submit
  button disabled (in `Button`, for `type="submit"`, so no form can be missed), and the Ctrl/⌘+Enter
  save shortcuts checked too. An error while offline reads "Can't reach FairShare".

### Accessibility

axe checks every screen against WCAG 2.1 A and AA, contrast included, in the light and dark themes,
at desktop and phone sizes: sign-in, the code step, a group's three tabs, Add expense and its split
sheet, Settle up, Home, an expense, a friend, Activity, New group, Settings, Delete account, an
invite, Privacy, Terms, Not found. A keyboard pass checks every Tab stop on Home is named and shows
focus. Fixes are under "Problems found".

### Errors, empty states and skeletons

- `ERROR_COPY` is now a full record of every code (`Record<ApiErrorCode, string>`): 18 of the 36 codes had
  no copy. A code added without copy fails the type check, and a test checks every code at run
  time.
- Audited every screen: loading has a skeleton, failure an error with Retry and the request ID,
  and nothing-yet an empty state. Two gaps fixed: Add expense showed its skeleton forever if a load
  failed, and Edit opened nothing at all while loading or on failure.

### Nightly invariant check, backups and the restore test

- **`checkInvariants`** (`packages/db`): transactions whose payers or shares don't add up (I1–I3),
  groups whose nets don't sum to zero (I6), and live transactions written after someone in them
  left (I8), in one read-only, repeatable-read transaction.
- **`.github/workflows/nightly.yml`**, at 03:00 India time:
  - the invariant check, as a login in `fairshare_readonly` (migration 0003);
  - a backup: `pg_dump` in a Postgres 17 container, encrypted with AES-256 (gpg) before it leaves
    the runner, uploaded to S3-compatible storage (R2, B2, S3), older than 30 days deleted.
- **`.github/workflows/restore-test.yml`**, quarterly: restores the newest backup into a throwaway
  Postgres and checks every migration and trigger came back and the invariant check is clean.
- Both are **off until switched on** with a repository variable, and print **counts only**: the
  repository and its logs are public. A failed scheduled run emails you; that's the alert.
- [docs/operations.md](../operations.md): setting it up, what to do when the check finds something,
  and restoring for real.

### Privacy notice and terms

`/privacy` and `/terms`, open to everyone, linked from sign-in (with "By continuing you agree…"),
Settings and each other. Every statement in the privacy notice describes what the code does:
what's stored, who sees it, the providers (Railway, Neon, Resend, Google, Sentry), typed sentences
staying in the browser, retention and deletion, rights under India's DPDP Act. The contact is
`VITE_CONTACT_EMAIL` when set, else the GitHub page.

### Compression

The server now gzips what the web build serves (not API responses). The main script went from
292 KB to 94 KB on the wire, and Lighthouse's mobile performance from 64 to 93 (below).

## Decisions and deviations

- **Deleted accounts stay where something is owed.** The plan removes a deleted user only from
  settled friendships. Leaving every settled group too keeps them out of everyone's "everyone"
  splits; staying where a balance remains is the only way the others can still record a payment.
  `UserRef.isDeleted` is a contract addition (responses drop unknown keys, so an older page still
  open is unaffected).
- **Better Auth's rate limits were on only because `NODE_ENV=production`.** Now they're on
  explicitly (`rateLimit: true`), with in-memory storage; integration tests turn them off unless the
  test is about them.
- **Per-user API limit in the end-to-end tests:** 120 a minute was never reached by the fastest
  test (each uses a new person).
- **Backups use the database owner, the check uses `fairshare_readonly`.** `pg_dump` also reads
  sequences and Drizzle's migration table, which the read-only role can't; no new grant or
  migration was needed for that.
- **Backups are encrypted by us**, not only by the provider: gpg AES-256 under a passphrase kept in
  GitHub Secrets and your password manager.
- **No "Lighthouse PWA" score:** Lighthouse removed its PWA category in version 12. Installability
  and offline are tested end to end instead (manifest, icons, service worker control, offline load,
  Save disabled); Lighthouse covers accessibility, best practices and performance.
- **The contracts package lost `"sideEffects": false`.** It needs one import with an effect (zod's
  jitless setting, see below), and Rolldown dropped it otherwise, even when the file was listed in
  a `sideEffects` array. The cost is 2.2 KB of JavaScript.
- **The privacy notice and terms are written for this app, not by a lawyer.** "Governed by the
  laws of India" assumes you operate from India; check both before a public launch.

## Problems found and fixed

1. **`PATCH /me` with an empty body answered 500** (Drizzle has no "update nothing"). Found by the
   new authorization matrix; now it returns the profile unchanged.
2. **zod tripped the CSP in every page load.** zod 4 tries `new Function` once, as the first object
   schema is built; the CSP blocks it and zod copes, but the browser reports a violation. Chrome
   didn't log it, so the end-to-end tests never saw it until they listened for violation events.
   Fixed with zod's `jitless`, set in the contracts package's first import (it must run before any
   schema is built, and setting it in `main.tsx` was too late: the bundle builds the schemas
   first).
3. **Colour contrast below WCAG AA:** muted text on the grey background (4.3:1, tabs and labels)
   and on the dark theme's accent (3.7:1, the active sidebar link and selected options). Muted
   text is darker in the light theme (`#566476`) and lighter in the dark (`#aab6c8`), and a link's
   inactive colours now apply only when it's inactive.
4. **"Equal" was announced as "Equally"** (WCAG 2.5.3: a voice user says what they see); now
   "Equal split".
5. **Offline, the app showed only "Something went wrong"**, with no offline banner (the root error
   screen replaced it). It now shows the banner and "Can't reach FairShare".
6. **A friendship still listed someone who left it.** Before this phase nobody could leave one, so
   the friend list never checked; it does now.
7. **An old test read the activity log in no particular order** and took the last row; it failed
   once in a parallel run. Every such read is ordered now.
8. **The invariant tests first cloned a database per test**, which timed out when every package's
   tests ran at once; they share one now, each putting back what it broke.

## Verification

- `pnpm check` passes, twice in a row.

  | Package    | Tests     |
  | ---------- | --------- |
  | core       | 382       |
  | contracts  | 287       |
  | api-client | 64        |
  | db         | 101       |
  | api        | 482       |
  | web        | 148       |
  | **Total**  | **1,464** |

- **The authorization matrix, in full** (`apps/api/src/authorization.test.ts`): every API route ×
  {signed out, outsider, member who left, member, owner}, each against a fresh group: 36 rows, 180
  cases, plus account deletion. A last test fails if a route is added without a row.
- **Rate limits:** each limit reached and answered 429 with `Retry-After`, per user and per IP,
  and Better Auth's sign-in limit per IP.
- **Account deletion:** 10 integration tests (settled and unsettled groups and friendships,
  ownership, closing a group, signed out everywhere, pending codes, the same address starting
  afresh, `{confirm}` required, never offered or made owner).
- **End-to-end: 78 of 78, twice** (39 tests × desktop and phone). New:
  - deleting an account from Settings, then signing up again with the same address;
  - the legal pages from sign-in;
  - the manifest, icons and service worker; the app opening offline; Save off while offline (and
    Ctrl+Enter refused);
  - axe on every screen above in both themes, and the keyboard pass;
  - every test now fails on any CSP violation event.
- **Lighthouse 13.6** (mobile, throttled) against the Docker image:

  | Screen  | Performance | Accessibility | Best practices |
  | ------- | ----------- | ------------- | -------------- |
  | Sign-in | 94          | 100           | 100            |
  | Home    | 93          | 100           | 100            |
  | A group | 83          | 100           | 100            |
  | Privacy | 95          | 100           | 100            |

  Before compression, Home was 64 (first paint 4.7 s; now 2.6 s).

- **Bug injection: 22 of 22 caught** (one missed at first: the "written after leaving" test used a
  transaction created after the person left, so a check reading only `created_at` passed; it now
  edits one created before):
  - (API) `{confirm}` not required; settled groups not left; a deleted account made owner, offered
    in `/people`, or listed after leaving a friendship; pending codes kept; the empty `PATCH /me`;
    no per-user limit; no per-IP limit on sign-in options; Better Auth's limits off; CSP without
    `worker-src`; no Permissions-Policy; API responses compressed; a route without a matrix row
  - (db) the invariant check missing share sums, or edits after leaving
  - (contracts, web) zod's jitless off; offline errors worded generically; a code without copy;
    deleted accounts in new expenses; a left friendship still linking
  - (end-to-end) Save not disabled offline
- **Restore drill** (recorded in docs/operations.md): the end-to-end database backed up, encrypted,
  uploaded to S3-compatible storage (SeaweedFS), an expired backup pruned, the newest downloaded and
  restored: 4 of 4 migrations, all 5 triggers, invariants clean, every table's row count identical.
  A wrong passphrase is refused.
- **Invariant check** against the development and end-to-end databases: clean.
- **Docker image:** migrations run twice, the smoke test passes (now also checking the
  Permissions-Policy, the manifest and the service worker's `no-cache`), no error logs.

## Lined up next

**To finish Phase 13:**

1. **Commit and push.** No migrations. New dependencies: `vite-plugin-pwa`, `workbox-build`,
   `workbox-window` (web), `@axe-core/playwright` (e2e).
2. **Check on staging:**
   - Settings → Delete account with a test account that owes something: the balance is listed,
     deleting signs you out, and the other person sees "Deleted user" and can settle.
   - Install it (Chrome's install button, or "Add to Home screen" on a phone); turn on airplane
     mode and open it.
   - `/privacy` and `/terms` while signed out.
3. **Switch on the nightly jobs** ([docs/operations.md](../operations.md)): the read-only login, a
   bucket and its token, the passphrase (in your password manager first), the GitHub secrets and
   variables, then run both workflows once by hand. Set `VITE_CONTACT_EMAIL` before the app is
   public.

**Phase 14: production deployment and real-world trial** (plan §11), after your go-ahead.

**Noted for later:**

- An activity verb unknown to an older page fails that page's activity feed until it reloads
  (`member.deleted` is the first new verb since launch). With the update prompt, few pages stay
  old for long; a lenient verb schema on the client would remove the gap.
- New tables need `GRANT SELECT … TO fairshare_readonly` in their migration (0003 granted only the
  tables that existed then).
