# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Vendored SDK tarballs (file: deps in package.json) must exist before npm ci.
# @ministryofmany/identity is consumed from a commit-pinned tarball checked
# into vendor/ (the npm release does not carry the minister-link module yet).
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# SvelteKit's postbuild analyse step imports the server chunks, and the db
# client asserts DATABASE_URL at module scope. postgres-js connects lazily, so
# a placeholder satisfies the assert without any connection attempt. Build-
# stage only — the runtime stage below starts from a fresh base image.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
# prebuild downloads Semaphore artifacts from snark-artifacts.pse.dev into
# static/ so the running app can serve them same-origin.
RUN npm run build
# --force: @cloudflare/blindrsa-ts declares engines.node >=24, which makes
# `npm prune` hard-fail on node 22. The dep is only ever bundled into the
# BROWSER build (src/lib/client/vote-token.ts); nothing server-side imports
# it, so the engine gate is irrelevant to this runtime.
RUN npm prune --omit=dev --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/static/snark-artifacts ./build/client/snark-artifacts
COPY --from=build /app/snark-artifacts.lock.json ./snark-artifacts.lock.json
EXPOSE 3000
CMD ["sh", "-c", "node --experimental-strip-types scripts/migrate.ts && node build"]
