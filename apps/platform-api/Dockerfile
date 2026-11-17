FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/shared-types packages/shared-types
COPY apps/platform-api/package.json apps/platform-api/package.json
RUN --mount=type=cache,target=/root/.npm npm install
RUN npx tsc -p packages/shared-types/tsconfig.json
# Dereference workspace symlinks so Docker COPY produces real directories
RUN for pkg in shared-types; do \
      target="node_modules/@ecomate/$pkg"; \
      [ -L "$target" ] && rm -rf "$target" && mkdir -p "$target" && \
      cp "packages/$pkg/package.json" "$target/" && \
      cp -r "packages/$pkg/dist" "$target/"; \
    done
# Flatten workspace-nested modules into the root node_modules. npm nests a
# dep under apps/platform-api/node_modules when its version conflicts with
# the lockfile's top-level pin (platform-api wants @fastify/helmet ^13.2.0
# but the lockfile pins 13.1.1 for the backend, which is not in this build
# context). The runner carries only the root node_modules, so a nested
# module would be missing at runtime (MODULE_NOT_FOUND — proven live:
# @fastify/helmet was the only one of 22 deps absent). The runner has no
# other workspaces, so flattening cannot conflict.
RUN if [ -d apps/platform-api/node_modules ]; then cp -r apps/platform-api/node_modules/. node_modules/; fi
COPY apps/platform-api apps/platform-api
WORKDIR /app/apps/platform-api
# The Prisma client generates into src/generated/prisma (schema.prisma
# `output`) as JavaScript; it is copied into dist/ by the builder step
# below (tsc does not copy .js files) and into ./src/generated here for
# the seed, which imports the generated client from src/.
RUN npx prisma generate
RUN npm run build
# `prisma generate` emits JavaScript (client.js, index.js, ...); tsc does
# not copy .js files to dist (no allowJs), so the generated client would
# be missing from dist/ at runtime (MODULE_NOT_FOUND for
# ../generated/prisma — proven live). Copy it into dist/ alongside the
# compiled app so dist/src/prisma/prisma.service.js resolves it. The
# chmod is load-bearing: `prisma generate` creates its output dirs mode
# 750 (root-owned), and the runtime user (nestjs, uid 1001) could not
# traverse them — the require failed with MODULE_NOT_FOUND even though
# the files were present.
RUN cp -r src/generated dist/src/generated && chmod -R a+rX dist/src/generated

# NOTE: no obfuscator stage (unlike the backend). The platform API holds
# control-plane logic (billing, audit); readable stack traces matter more
# here than obfuscation. Phase 8 decision D15.
FROM node:24.22.1-alpine AS runner
WORKDIR /app
RUN apk add --no-cache postgresql-client && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/platform-api/dist ./dist
COPY --from=builder /app/apps/platform-api/prisma ./prisma
# prisma/seed.ts imports the generated client from src/ (single source of
# truth with the runtime). tsx transpiles it on demand, so the generated
# client source must exist in the runtime image alongside prisma/.
COPY --from=builder /app/apps/platform-api/src/generated ./src/generated
COPY --from=builder /app/apps/platform-api/prisma.config.ts ./
COPY --from=builder /app/apps/platform-api/package.json ./
COPY apps/platform-api/startup.sh ./startup.sh
RUN mkdir -p /app/data/tenant-exports && \
    chown -R nestjs:nodejs /app/data && \
    chmod +x startup.sh
USER root
EXPOSE 4100
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4100/api/health || exit 1
CMD ["./startup.sh"]
