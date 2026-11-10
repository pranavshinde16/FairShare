# FairShare

Split shared expenses with friends, roommates and trip groups. No daily limits, no ads, no paywalled
basics.

> Status: early development. Phases 0–3 (foundation, core domain logic, API contracts, database)
> are complete; Phase 4 (API skeleton and staging deploy) is in progress. See the
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
pnpm db:up        # Postgres on localhost:5433, Mailpit inbox on http://localhost:8025
pnpm db:migrate   # create the tables (safe to re-run)
pnpm db:seed      # optional: the demo "Goa Trip" group (safe to re-run)
pnpm dev          # API on http://localhost:3000, web app on http://localhost:5173
```

Open http://localhost:5173. The page reports whether the API and database are reachable.

## Scripts

| Command                  | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `pnpm dev`               | Run the API and web app with live reload      |
| `pnpm build`             | Production builds of both apps                |
| `pnpm test`              | Unit and integration tests (needs `db:up`)    |
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
docker run --rm --network host -e DATABASE_URL=... fairshare                        # port 3000
scripts/smoke-test.sh http://localhost:3000
```

Without Docker: `pnpm build && WEB_DIST_DIR=../web/dist pnpm --filter @fairshare/api start`.

Staging runs on Railway and Neon; see [docs/deploy-staging.md](docs/deploy-staging.md).

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the package layout, dependency rules and the financial
invariants the code must uphold.
