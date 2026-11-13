# One image for the whole app: the API serves the built web app, so production is one origin.
#
#   docker build -t fairshare .
#   docker run --rm fairshare node dist/migrate.js   # pre-deploy step: apply migrations
#   docker run --rm -p 3000:3000 fairshare            # the server
#
# Configuration comes from environment variables at run time (see .env.example), except the
# browser's VITE_* values, which Vite bakes into the web build and so are build arguments.

# ---- build: install everything, build web + API, then prune to the API's production deps -------
FROM node:24-alpine AS build
WORKDIR /repo
ENV CI=true TURBO_TELEMETRY_DISABLED=1
# pnpm at exactly the version in package.json's "packageManager".
RUN corepack enable pnpm

# Downloads every package in the lockfile. This layer is reused until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Public values for the browser build (a Sentry DSN is not a secret).
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENVIRONMENT=""
ARG VITE_CONTACT_EMAIL=""
RUN pnpm turbo run build --filter=@fairshare/api --filter=@fairshare/web

# The API bundles the workspace packages it uses (see apps/api/tsup.config.ts), so its runtime
# needs only its own third-party dependencies.
RUN pnpm --filter=@fairshare/api deploy --prod --legacy /prod/api

# ---- runtime: Node, the API bundle and its dependencies, the web build, the migrations ---------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST_DIR=/app/web

COPY --from=build /prod/api ./
COPY --from=build /repo/apps/web/dist ./web
# dist/migrate.js reads these from ../migrations.
COPY --from=build /repo/packages/db/migrations ./migrations

# Files stay owned by root: the server can read its code but not change it.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
