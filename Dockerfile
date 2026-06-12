# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prebuild downloads Semaphore artifacts from snark-artifacts.pse.dev into
# static/ so the running app can serve them same-origin.
RUN npm run build
RUN npm prune --omit=dev

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
