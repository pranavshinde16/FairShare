# Deploying staging

Staging runs on **Railway** (the app), **Neon** (Postgres), **Sentry** (error tracking), **Resend**
(sign-in emails) and **Google** (sign-in with Google), with **Cloudflare** in front once there is a
domain. Railway deploys `main` automatically after CI
passes, runs the migrations first, and a GitHub workflow smoke-tests the live site after each
deploy.

What the repository defines:

| File                                  | What it sets                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `Dockerfile`                          | The image: web build + API bundle + migrations                                     |
| `.github/workflows/staging-smoke.yml` | `scripts/smoke-test.sh` against `STAGING_URL` after each successful staging deploy |

The Railway service settings live in the **Railway dashboard**, listed in
[step 5](#5-railway-the-app). There is no `railway.json`: Railway's Config as Code is deprecated,
new services can't opt into it, and existing files stop being read on 2026-12-01.

Everything below is done in each service's dashboard. **Passwords, connection strings, API keys,
client secrets and DSNs go only into those dashboards, never into the repository or a chat.**

Pick the **same region** everywhere: Singapore is the closest to India that both Railway and Neon
offer.

## 0. Put the code on GitHub

Railway deploys from https://github.com/pranavshinde16/FairShare, so the code must be committed and
pushed to `main` first. The CI run on that push is what Railway waits for.

## 1. Neon (database)

1. Create a project named `fairshare`: Postgres 17, region **AWS Asia Pacific (Singapore)**. Its
   default branch is called `production`.
2. Create a branch named `staging` from `production`. Use the `staging` branch for every step
   below, including the connection strings: a string copied with the wrong branch selected
   silently points staging at `production`.
3. Make a password for the app's database user on your own machine:

   ```bash
   openssl rand -hex 24
   ```

4. Open the **SQL Editor** on the `staging` branch, database `neondb`, and run the following,
   pasting that password:

   ```sql
   -- Safe to re-run. fairshare_app may already exist: migration 0003 creates it, and a branch
   -- copies its parent's roles, so a branch made from a migrated parent has it already.
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairshare_app') THEN
       CREATE ROLE fairshare_app NOLOGIN;
     END IF;
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fairshare_api') THEN
       CREATE ROLE fairshare_api LOGIN;
     END IF;
   END
   $$;
   -- The API's login. It gets only fairshare_app's permissions. Re-running sets a new password.
   ALTER ROLE fairshare_api LOGIN PASSWORD 'paste-the-password-here';
   GRANT fairshare_app TO fairshare_api;
   ```

   Create this role with SQL, **not** on the Roles page: roles created on the Roles page join
   `neon_superuser`, which overrides the grants (for example, the API's inability to delete
   activity history). Check it:

   ```sql
   SELECT rolname, rolcanlogin,
          pg_has_role(rolname, 'fairshare_app', 'member') AS has_app_grants,
          pg_has_role(rolname, 'neon_superuser', 'member') AS is_superuser_member
   FROM pg_roles WHERE rolname = 'fairshare_api';
   ```

   Expect `rolcanlogin` and `has_app_grants` true, and `is_superuser_member` **false**. A second run
   prints a NOTICE that `fairshare_api` is already a member of `fairshare_app`; that's expected.

5. Copy two connection strings from **Connect** (branch `staging`, database `neondb`):

   | Variable                 | Role            | Connection pooling  |
   | ------------------------ | --------------- | ------------------- |
   | `MIGRATION_DATABASE_URL` | `neondb_owner`  | off (direct)        |
   | `DATABASE_URL`           | `fairshare_api` | on (`-pooler` host) |

   Neon doesn't know a password set with SQL, so for `fairshare_api` put yours into the string.

   In both, replace the query string (`?sslmode=require&channel_binding=require`) with
   `?sslmode=verify-full`. The connection is still encrypted, and the server's certificate is fully
   checked; node-postgres warns about `sslmode=require`. Neon refuses unencrypted connections in
   any case.

6. Optionally, test each string from your machine with `psql` 16 or later. psql needs
   `&sslrootcert=system` added to verify Neon's certificate (node-postgres doesn't, so don't add it
   in Railway). Reading the string with `read -s` keeps it out of your shell history:

   ```bash
   read -rs DB_URL   # paste the string, then Enter
   psql "${DB_URL}&sslrootcert=system" -c 'SELECT current_user'
   unset DB_URL
   ```

## 2. Sentry (error tracking)

1. Create two projects: platform **Node.js** named `fairshare-api`, and platform **React** named
   `fairshare-web`.
2. Copy each project's **DSN** (Project settings → Client Keys). A DSN only lets someone send
   events, not read them, so it's fine in the browser bundle.

## 3. Resend (sign-in emails)

1. Sign up at https://resend.com.
2. **API Keys → Create API key**, permission **Sending access**. Copy it: Resend shows it once.
3. The sender. Until FairShare has its own domain, use Resend's test address,
   `FairShare <onboarding@resend.dev>`. It delivers **only to your Resend account's own email
   address**, so on staging only you can sign in with an email code (Google sign-in works for
   anyone allowed in step 4). With a domain, verify it under **Domains** (Resend lists the DNS
   records to add) and change `EMAIL_FROM` to an address on it; see step 7.

## 4. Google sign-in

In the Google Cloud console (https://console.cloud.google.com):

1. Create a project named `FairShare`.
2. Open **Google Auth Platform** (formerly "OAuth consent screen"):
   - **Branding:** app name `FairShare`, your email as the support and developer contact.
   - **Audience:** **External**, left in **Testing**. Add your own Google address, and any friend
     who will test, under **Test users**: while the app is in testing, only they can sign in.
     Publishing comes at launch (Phase 14); FairShare asks only for the basic `openid`, `email`
     and `profile` scopes.
3. **Clients → Create client**, type **Web application**, name `FairShare staging`:
   - Authorized JavaScript origins: `https://fairshareapi-staging.up.railway.app`
   - Authorized redirect URIs:
     `https://fairshareapi-staging.up.railway.app/api/auth/callback/google`

   Both must match `APP_URL` (step 5) exactly: https, the same host, no trailing slash on the
   origin. A mismatch shows Google's `redirect_uri_mismatch` error.

4. Copy the **Client ID** and **Client secret**.

To try Google sign-in locally, add `http://localhost:5173` as an origin and
`http://localhost:5173/api/auth/callback/google` as a redirect URI (on this client, or on a
separate development client), and put its ID and secret in your `.env`.

## 5. Railway (the app)

1. **New project → Deploy from GitHub repo**, and give Railway's GitHub app access to the
   `FairShare` repository only.
2. **One service, not two.** Railway sees the pnpm workspace and creates a service per app
   (`@fairshare/api` and `@fairshare/web`), each with a `pnpm --filter` build command and watch
   paths. FairShare is one service: the API serves the web build. **Delete the `@fairshare/web`
   service**, and rename the other `fairshare` (**Settings → Service name**) before generating its
   domain, since the generated domain is made from the service name.
3. Rename the project `fairshare` (Railway gives it a random name). The project and environment
   names show up on GitHub as the deployment environment, e.g. `fairshare / staging`.
4. Name the environment **`staging`**: rename the default `production` environment, or create
   `staging` and delete the default. The post-deploy smoke test only runs for deployments whose
   environment name contains "staging".
5. In the service's **Settings**, set all of the following. The dashboard is the only place they
   are recorded, so this table is the reference.

   | Setting                             | Value                         | Why                                                                           |
   | ----------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
   | Source: branch                      | `main`                        |                                                                               |
   | Source: **Wait for CI**             | on                            | A commit deploys only after CI passes; see [below](#wait-for-ci)              |
   | Root directory                      | empty                         | The Dockerfile builds from the repository root                                |
   | Watch paths                         | empty                         | Any change can affect the image                                               |
   | Builder                             | Dockerfile                    |                                                                               |
   | Dockerfile path                     | `/Dockerfile`                 |                                                                               |
   | Custom build command, start command | empty                         | The Dockerfile's `CMD` starts the server                                      |
   | **Pre-deploy command**              | `node dist/migrate.js`        | Migrations and reference data, before the new version takes traffic           |
   | **Healthcheck path**                | `/api/health`                 | A deploy whose database is unreachable fails instead of going live            |
   | Healthcheck timeout                 | `120`                         | Seconds; boot takes a few                                                     |
   | Region                              | Southeast Asia (Singapore)    | Next to the Neon database                                                     |
   | Replicas                            | `1`                           | Sign-in code limits keep their counts in memory                               |
   | Serverless (sleep when idle)        | off                           | A sleeping service makes the first request slow                               |
   | Restart policy                      | On failure, at most 5 retries | A crash loop stops instead of retrying forever                                |
   | Draining time                       | `15` seconds                  | Longer than the server's own 10-second shutdown, so in-flight requests finish |

   The pre-deploy command and the health check matter most. Without the health check, Railway
   marks a deploy live even when every request fails with 503.

6. **Networking → Generate Domain.** This is the staging URL until there's a custom domain.
7. In **Variables** (the raw editor is quickest), set:

   ```text
   DATABASE_URL=<fairshare_api pooled connection string>
   MIGRATION_DATABASE_URL=<neondb_owner direct connection string>
   APP_URL=https://fairshareapi-staging.up.railway.app
   AUTH_SECRET=<output of: openssl rand -base64 32>
   RESEND_API_KEY=<Resend API key>
   EMAIL_FROM=FairShare <onboarding@resend.dev>
   GOOGLE_CLIENT_ID=<Google client ID>
   GOOGLE_CLIENT_SECRET=<Google client secret>
   SENTRY_DSN=<fairshare-api DSN>
   SENTRY_ENVIRONMENT=staging
   SENTRY_RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}
   VITE_SENTRY_DSN=<fairshare-web DSN>
   VITE_SENTRY_ENVIRONMENT=staging
   ```

   - Don't set `PORT`: Railway provides it. `VITE_*` values reach the web build automatically,
     because the Dockerfile declares them as build arguments.
   - `APP_URL` is exactly the address people open (the domain generated in item 6 above, later the
     custom domain). Sign-in redirects are built from it, and the API refuses state-changing
     requests from any other origin.
   - Generate `AUTH_SECRET` on your own machine. Changing it later signs everyone out.
   - Leave `CLIENT_IP_HEADERS` unset: its default, `x-real-ip`, is the header Railway's proxy
     sets with the visitor's IP.
   - The server refuses to start without `APP_URL`, `AUTH_SECRET` and an email setting, and names
     what's missing in the deploy log. Set them **before** pushing code that needs them; until
     then the health check keeps the previous version live.

8. Deploy. The deploy logs should show:
   - from the pre-deploy step: `Migrations and reference data are up to date.`
   - then from the server: `FairShare API listening`
   - then the health check passing.

   If the health check fails, the logs say why. Each failed check logs
   `database health check failed` with the Postgres error code and message: for example `28P01`
   (wrong password, or the role is missing on this branch) or `ENOTFOUND` (a mistyped host).

### Wait for CI

Railway holds a deploy until **every GitHub Actions run on that commit** has finished, and skips
it if any run failed. That includes the "Staging smoke test" runs, which run on the commit
they test. So once a smoke run fails on a commit, Railway skips every later deploy of that same
commit with "CI check suite failed", including the redeploy after a variable change. Railway's
dashboard may still report the variable change as applied. A new commit isn't affected: it has
no failed runs yet.

To get unstuck after fixing the cause (a variable, the database, `STAGING_URL`):

- **Preferred:** GitHub → **Actions → "Staging smoke test"**, open the failed run, **Re-run all
  jobs**. A re-run replaces the run's result, so once it passes, the commit is clear and
  Railway's next deploy of it goes ahead. This only helps when staging is already serving the
  fixed version, for example when the smoke test itself was misconfigured.
- **Otherwise:** Railway → **Deployments → ⋮ → Deploy commit** deploys the commit by hand. Then
  re-run the failed smoke run as above, so the next automatic redeploy isn't skipped.

## 6. GitHub (post-deploy smoke test)

**Settings → Secrets and variables → Actions → Variables tab → New repository variable:**
`STAGING_URL` = the Railway URL, e.g. `https://fairshare-staging.up.railway.app` (no trailing
slash needed).

It must be a **variable, not a secret**: the workflow reads `vars.STAGING_URL`, and a secret of the
same name is invisible to it. The URL isn't secret anyway; it's public.

## 7. Cloudflare (once you have a domain)

1. Railway service → **Settings → Networking → Custom Domain**: add e.g. `staging.example.com`.
   Railway shows the DNS record(s) it needs.
2. In Cloudflare **DNS**, add those records. Keep the CNAME **DNS only** (grey cloud) until Railway
   shows the domain as verified with a certificate.
3. Then switch it to **Proxied** (orange cloud), and set **SSL/TLS → Full (strict)**.
4. Change the `STAGING_URL` variable to the new address.
5. In Railway, change `APP_URL` to the new address, and add it to the Google client's JavaScript
   origins and redirect URIs (step 4).
6. Set `CLIENT_IP_HEADERS=cf-connecting-ip` in Railway: behind Cloudflare, Railway's `x-real-ip`
   is a Cloudflare address. (The railway.app address stays reachable without Cloudflare and could
   be sent a forged header; the per-email code limit still applies there.)
7. Verify the domain in Resend (step 3) and change `EMAIL_FROM` to an address on it.

## 8. Check it works

- Open the staging URL: it shows the **Sign in** page.
- **Email code:** sign in with your Resend account's address. The code arrives within a minute;
  you land on Home ("Hi, <name>").
- **Google:** sign out (Settings → Sign out), then **Continue with Google** with a test-user
  account. You come back signed in. With the same address as the email-code sign-in, it's the
  same FairShare account.
- **Settings:** change your name or default currency, save, reload: the change stays.
- `scripts/smoke-test.sh <staging-url>` from your machine should pass every check.
- **GitHub → Actions → "Staging smoke test"** should have run green after the deploy. If it
  failed at "Check STAGING_URL is set", see step 6. If it didn't run, check the environment name
  under the repository's **Deployments**, and use **Run workflow** to start it by hand.
- **Browser Sentry:** in the staging page's developer console, run
  `setTimeout(() => { throw new Error('Sentry test') })`. The error appears in `fairshare-web`
  within a minute.

## Later: production

Production will be a second Railway environment deployed by Git tag, with its own Neon branch. That
is set up at launch (Phase 14).

The Neon `production` branch has already been migrated once, by an early staging deploy whose
connection strings pointed at it. It has the schema, the reference data and the `fairshare_app`
and `fairshare_readonly` roles, but no user data. Migrations are idempotent, so it can be used as
is; decide at Phase 14 whether to start it fresh instead.
