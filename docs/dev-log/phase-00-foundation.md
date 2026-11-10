# Phase 0: Project foundation

- **Dates:** 2026-11-05
- **Status:** Done
- **Plan reference:** Implementation blueprint §11, Phase 0

## Goal

A monorepo where `pnpm dev` runs both apps and CI is green on an essentially empty project, with
the architecture's dependency rules enforced from day one.

## What was built

| Area                  | Result                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo              | pnpm workspaces + Turborepo; shared dependency versions in the `catalog:` of `pnpm-workspace.yaml`                                                                            |
| `packages/config`     | Strict tsconfig presets (`base`, `library`, `node`, `react`) with `noUncheckedIndexedAccess`; ESLint flat config                                                              |
| Boundary rules        | `no-restricted-imports` per package (core imports nothing; web never imports server code); `no-restricted-syntax` bans `Date.now()`, `new Date()` and `Math.random()` in core |
| `packages/core`       | `MAX_AMOUNT_MINOR` (10¹⁰) and `BASIS_POINTS_TOTAL` constants, with a test that the cap keeps integer math exact                                                               |
| `packages/contracts`  | `HealthResponse` zod schema                                                                                                                                                   |
| `packages/api-client` | `createApiClient` fetch wrapper; typed `ApiError` (network errors → status 0, `NETWORK_ERROR`)                                                                                |
| `packages/db`         | Empty shell (schema arrives in Phase 3)                                                                                                                                       |
| `apps/api`            | Hono app built by `createApp(deps)`; zod-validated `env.ts`; `GET /api/health` (200 up / 503 down); JSON 404 envelope; graceful shutdown                                      |
| `apps/web`            | Vite + React 19 page showing API/database status through the api-client; dev proxy for `/api`                                                                                 |
| Local services        | `docker-compose.yml`: Postgres 17 (`fairshare` + `fairshare_test` databases) on host port 5433, Mailpit                                                                       |
| CI                    | `.github/workflows/ci.yml`: install (frozen lockfile) → format check → lint → typecheck → test → build, with a Postgres service container ready for later                     |
| Docs                  | `ARCHITECTURE.md` (dependency rules, invariants I1–I11, plan corrections), `README.md`                                                                                        |

## Decisions and deviations from the plan

- **TypeScript 6.0.x instead of 7.** `typescript-eslint` 8.72 supports TypeScript `< 6.1`.
- **Node 24 LTS via nvm.** The machine defaulted to Node 23; `.nvmrc` pins 24.
- **pnpm 10.34.9** pinned via `packageManager`. Only `esbuild` may run install scripts.
- **Just-in-time workspace packages.** Packages export TypeScript source; there is no per-package
  build step. Vite compiles them for the web app and tsup bundles them into the API.
- **Postgres on host port 5433**, because a system Postgres already uses 5432.
- **`docker-compose` v1** is what's installed (the `docker compose` plugin is not), so the scripts
  call `docker-compose`.
  - _Update 2026-11-07:_ Compose v2 (`docker compose`) has since replaced v1 on this machine, so
    `docker-compose` no longer exists. The scripts now call `docker compose`, which is the
    supported form. `db:up` also waits for the healthchecks before it returns.

## Problems found and fixed

- **The API crashed when Postgres restarted.** `pg.Pool` emits `'error'` when the server drops idle
  connections; with no listener Node treats it as fatal. Added a pool `'error'` listener and a
  regression test. Re-tested live: health goes 200 → 503 while the database is stopped → 200 after it
  restarts, with the API process staying up.
- Turbo warned about a missing `coverage/**` output for `test`; removed until coverage exists.

## Verification

- `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test`, `build`: all pass
  (20/20 Turbo tasks, 19 tests).
- Boundary rules proven by temporary violation files (core importing `zod`/`node:fs`, using
  `Date.now()`/`Math.random()`; web importing `@fairshare/db`; contracts importing `hono`): all
  rejected.
- Live: `GET /api/health` returns `{"ok":true,"db":"up"}` directly and through the Vite proxy;
  unknown routes return the JSON 404 envelope; starting without `DATABASE_URL` exits with a clear
  message.

## Not committed

Per instruction, nothing is committed or pushed until explicitly requested.

## Next

Phase 1: core domain logic (money, splits, ledger, simplification, invariants, activity diffs).
