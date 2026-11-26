# Phase 3 migration runner — one-off container for the Phase 2 central-auth
# data-migration scripts (01 -> 02 -> 03). Follows the apps/auth-service
# Dockerfile shape: node:24.22.1-alpine multi-stage, `npm install` with cache
# mount (repo convention, NOT `npm ci`), workspace install from the repo
# root, prisma generate in the builder, non-root runtime user.
#
# LAYOUT DECISION — scripts stay in place (see README.md): the Phase 2
# scripts live at apps/auth-service/scripts/ and are COPIED there unchanged,
# so the relative generated-client imports in scripts/lib/clients.ts resolve
# exactly as they did in the Phase 2 rehearsal. Nothing in the scripts is
# edited. The three Prisma clients are generated into their existing
# relative locations (same commands each app's own build uses).
#
# This image is NOT a service: no port, no healthcheck. It runs the scripts
# in order and exits (see entrypoint.sh). Build contract (matches
# .github/workflows/build-service-image.yml): context `.`, file
# `apps/migration-runner/Dockerfile`, platforms linux/amd64, no build args.
FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/migration-runner/package.json apps/migration-runner/package.json
RUN --mount=type=cache,target=/root/.npm npm install

# Phase 2 scripts, in place (unchanged) + the three schemas + their
# prisma.config.ts files (prisma 7 reads the config from the working
# directory when generating; the per-app package.json files are copied too
# so each generate runs in a layout identical to that app's own checkout).
COPY apps/auth-service/scripts apps/auth-service/scripts
COPY apps/backend/package.json apps/backend/package.json
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/schema.prisma
COPY apps/backend/prisma.config.ts apps/backend/prisma.config.ts
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY apps/platform-api/prisma/schema.prisma apps/platform-api/prisma/schema.prisma
COPY apps/platform-api/prisma.config.ts apps/platform-api/prisma.config.ts
COPY apps/auth-service/package.json apps/auth-service/package.json
COPY apps/auth-service/prisma/schema.prisma apps/auth-service/prisma/schema.prisma
COPY apps/auth-service/prisma.config.ts apps/auth-service/prisma.config.ts

# Generate ALL THREE clients in their existing relative locations.
# Verified live 2026-11-26 (prisma 7.10.0, the version the lockfile resolves):
#   backend:      "Generated Prisma Client (v7.10.0) to ./../../node_modules/@prisma/client"
#                 (files land in /app/node_modules/.prisma/client; the
#                 @prisma/client stub re-exports .prisma/client/default)
#   platform-api: "Generated Prisma Client (v7.10.0) to ./src/generated/prisma"
#   auth-service: "Generated Prisma Client (v7.10.0) to ./src/generated/prisma"
# Each generate needs NO database env vars (no datasource URL is required
# to generate; the configs tolerate unset *_DATABASE_URL).
WORKDIR /app/apps/backend
RUN npx prisma generate
WORKDIR /app/apps/platform-api
RUN npx prisma generate
WORKDIR /app/apps/auth-service
RUN npx prisma generate

FROM node:24.22.1-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
# Whole node_modules: carries tsx, better-auth, pg, the adapter AND the
# generated tenant client at node_modules/.prisma/client (behind the
# @prisma/client stub). The prisma CLI binary rides along unused at runtime.
COPY --from=builder /app/node_modules ./node_modules
# Phase 2 scripts (unchanged) + the two generated clients with custom
# output dirs, in the exact relative locations scripts/lib/clients.ts
# imports them from.
COPY --from=builder /app/apps/auth-service/scripts ./apps/auth-service/scripts
COPY --from=builder /app/apps/platform-api/src/generated ./apps/platform-api/src/generated
COPY --from=builder /app/apps/auth-service/src/generated ./apps/auth-service/src/generated
COPY apps/migration-runner/entrypoint.sh ./apps/migration-runner/entrypoint.sh
COPY apps/migration-runner/package.json ./apps/migration-runner/package.json
RUN mkdir -p /app/out && chown nestjs:nodejs /app/out && \
    chmod +x /app/apps/migration-runner/entrypoint.sh
USER nestjs
ENV NODE_ENV=production
WORKDIR /app/apps/auth-service
ENTRYPOINT ["/app/apps/migration-runner/entrypoint.sh"]
CMD []
