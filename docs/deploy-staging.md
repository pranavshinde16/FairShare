# Deploying staging

Staging runs on **Railway** (the app), **Neon** (Postgres) and **Sentry** (error tracking), with
**Cloudflare** in front once there is a domain. Railway deploys `main` automatically after CI
passes, runs the migrations first, and a GitHub workflow smoke-tests the live site after each
deploy.

What the repository already defines:

| File                                  | What it sets                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                          | The image: web build + API bundle + migrations                                                                      |
| `railway.json`                        | Build from the Dockerfile; pre-deploy `node dist/migrate.js`; health check `/api/health`; one replica, never sleeps |
| `.github/workflows/staging-smoke.yml` | `scripts/smoke-test.sh` against `STAGING_URL` after each successful staging deploy                                  |

Everything below is done in each service's dashboard. **Passwords, connection strings and DSNs go
only into those dashboards, never into the repository or a chat.**

Pick the **same region** everywhere: Singapore is the closest to India that both Railway and Neon
offer.

## 0. Put the code on GitHub

Railway deploys from https://github.com/pranavshinde16/FairShare, so the code must be committed and
pushed to `main` first. The CI run on that push is what Railway waits for.

## 1. Neon (database)

1. Create a project named `fairshare`: Postgres 17, region **AWS Asia Pacific (Singapore)**.
2. Create a branch named `staging` from `main`. Use the `staging` branch for every step below.
3. Make a password for the app's database user on your own machine:

   ```bash
   openssl rand -hex 24
   ```

4. Open the **SQL Editor** on the `staging` branch and run the following, pasting that password:

   ```sql
   -- The group role the migrations grant permissions to (they skip it if it exists).
   CREATE ROLE fairshare_app NOLOGIN;
   -- The API's login. It gets only fairshare_app's permissions.
   CREATE ROLE fairshare_api LOGIN PASSWORD 'paste-the-password-here' IN ROLE fairshare_app;
   ```

   Create this role with SQL, **not** on the Roles page: roles created on the Roles page join
   `neon_superuser`, which overrides the grants (for example, the API's inability to delete
   activity history).

5. Copy two connection strings from **Connect** (branch `staging`, database `neondb`):

   | Variable                 | Role            | Connection pooling  |
   | ------------------------ | --------------- | ------------------- |
   | `MIGRATION_DATABASE_URL` | `neondb_owner`  | off (direct)        |
   | `DATABASE_URL`           | `fairshare_api` | on (`-pooler` host) |

   In both, replace the query string (`?sslmode=require&channel_binding=require`) with
   `?sslmode=verify-full`. The connection is still encrypted, and the server's certificate is fully
   checked; node-postgres warns about `sslmode=require`. Neon refuses unencrypted connections in
   any case.

## 2. Sentry (error tracking)

1. Create two projects: platform **Node.js** named `fairshare-api`, and platform **React** named
   `fairshare-web`.
2. Copy each project's **DSN** (Project settings → Client Keys). A DSN only lets someone send
   events, not read them, so it's fine in the browser bundle.

## 3. Railway (the app)

1. **New project → Deploy from GitHub repo**, and give Railway's GitHub app access to the
   `FairShare` repository only. Railway reads `railway.json`, so the build, pre-deploy step and
   health check need no settings.
2. Name the environment **`staging`**: rename the default `production` environment, or create
   `staging` and delete the default. The post-deploy smoke test only runs for deployments whose
   environment name contains "staging".
3. In the service's **Settings**:
   - **Region:** Southeast Asia (Singapore).
   - **Source:** branch `main`, and turn on **Wait for CI**, so a commit deploys only after the CI
     workflow passes.
   - **Networking → Generate Domain.** This is the staging URL until there's a custom domain.
4. In **Variables** (the raw editor is quickest), set:

   ```text
   DATABASE_URL=<fairshare_api pooled connection string>
   MIGRATION_DATABASE_URL=<neondb_owner direct connection string>
   SENTRY_DSN=<fairshare-api DSN>
   SENTRY_ENVIRONMENT=staging
   SENTRY_RELEASE=${{RAILWAY_GIT_COMMIT_SHA}}
   VITE_SENTRY_DSN=<fairshare-web DSN>
   VITE_SENTRY_ENVIRONMENT=staging
   ```

   Don't set `PORT`: Railway provides it. `VITE_*` values reach the web build automatically,
   because the Dockerfile declares them as build arguments.

5. Deploy. In the deploy logs, the pre-deploy step should print `Migrations and reference data are
up to date.`, then the server logs `FairShare API listening`, and the health check passes.

## 4. GitHub (post-deploy smoke test)

**Settings → Secrets and variables → Actions → Variables → New repository variable:**
`STAGING_URL` = the Railway URL, e.g. `https://fairshare-staging.up.railway.app` (no trailing
slash needed).

## 5. Cloudflare (once you have a domain)

1. Railway service → **Settings → Networking → Custom Domain**: add e.g. `staging.example.com`.
   Railway shows the DNS record(s) it needs.
2. In Cloudflare **DNS**, add those records. Keep the CNAME **DNS only** (grey cloud) until Railway
   shows the domain as verified with a certificate.
3. Then switch it to **Proxied** (orange cloud), and set **SSL/TLS → Full (strict)**.
4. Change the `STAGING_URL` variable to the new address.

## 6. Check it works

- Open the staging URL: the page should say **"Server and database are up"**.
- `scripts/smoke-test.sh <staging-url>` from your machine should pass every check.
- **GitHub → Actions → "Staging smoke test"** should have run green after the deploy. If it didn't
  run, check the environment name under the repository's **Deployments**, and use **Run workflow**
  to start it by hand.
- **Browser Sentry:** in the staging page's developer console, run
  `setTimeout(() => { throw new Error('Sentry test') })`. The error appears in `fairshare-web`
  within a minute.

## Later: production

Production will be a second Railway environment and a second Neon branch, deployed by Git tag.
That is set up at launch (Phase 14).
