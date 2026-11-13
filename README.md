# FairShare

Split shared expenses with friends, roommates and trip groups. No daily limits, no ads, no paywalled
basics.

> Status: early development. Phases 0–9 (foundation, core domain logic, API contracts, database,
> API skeleton with a live staging deploy, sign-in and profile, groups and invites, expenses,
> balances and Home, settlements) are complete; Phase 10 (activity feed and history search) is in
> progress. See the
> [development log](docs/dev-log/README.md).

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` picks the pinned version)
- Docker, for the local Postgres and email catcher

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env
# then set AUTH_SECRET in .env, e.g. to the output of: openssl rand -base64 32
pnpm db:up        # Postgres on localhost:5433, Mailpit inbox on http://localhost:8025
pnpm db:migrate   # create the tables (safe to re-run)
pnpm db:seed      # optional: the demo "Goa Trip" group (safe to re-run)
pnpm dev          # API on http://localhost:3000, web app on http://localhost:5173
```

Open http://localhost:5173 and sign in with any email address: the code arrives in Mailpit at
http://localhost:8025. After `pnpm db:seed`, sign in as `asha@example.com` or `bilal@example.com`
to see the demo data's users.

## Scripts

| Command                  | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `pnpm dev`               | Run the API and web app with live reload      |
| `pnpm build`             | Production builds of both apps                |
| `pnpm test`              | Unit and integration tests (needs `db:up`)    |
| `pnpm e2e`               | End-to-end tests (needs `db:up` and `build`)  |
| `pnpm lint`              | ESLint, including architecture boundary rules |
| `pnpm typecheck`         | TypeScript in every package                   |
| `pnpm format`            | Format everything with Prettier               |
| `pnpm check`             | Everything CI runs, except the build          |
| `pnpm db:up` / `db:down` | Start or stop the local Docker services       |
| `pnpm db:migrate`        | Apply migrations and reference data           |
| `pnpm db:seed`           | Add the demo Goa Trip group (dev only)        |

After changing `packages/db/src/schema`, run `pnpm --filter @fairshare/db generate` and commit the
new migration. CI fails if the schema and the migrations disagree.

## Production build

Production is one Docker image: the API serves the built web app, so everything is one origin.

```bash
docker build -t fairshare .
docker run --rm --network host -e DATABASE_URL=... fairshare node dist/migrate.js   # pre-deploy
docker run --rm --network host -e DATABASE_URL=... -e APP_URL=http://localhost:3000 \
  -e AUTH_SECRET=... -e MAILPIT_URL=http://localhost:8025 fairshare                 # port 3000
scripts/smoke-test.sh http://localhost:3000
```

Without Docker: `pnpm build && APP_URL=http://localhost:3000 WEB_DIST_DIR=../web/dist pnpm --filter
@fairshare/api start`. The server refuses to start with a missing or invalid setting and names it;
`.env.example` lists them all.

For the end-to-end tests, install the browser once with
`pnpm --filter @fairshare/e2e exec playwright install chromium`.

Staging runs on Railway and Neon; see [docs/deploy-staging.md](docs/deploy-staging.md).

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the package layout, dependency rules and the financial
invariants the code must uphold.
