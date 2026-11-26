# Central auth service — follows apps/backend + apps/platform-api shape:
# node:24.22.1-alpine multi-stage, npm install with cache mount (repo
# convention; the brief's `npm ci` is NOT what the other Dockerfiles use),
# workspace install from the repo root, prisma generate + build in the
# builder, non-root runtime user, wget HEALTHCHECK against /health.
FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/auth-service/package.json apps/auth-service/package.json
RUN --mount=type=cache,target=/root/.npm npm install
# Flatten workspace-nested modules into the root node_modules. npm nests
# better-auth under apps/auth-service/node_modules (the lockfile records no
# root copy — verified in package-lock.json), but the runner carries only
# the root node_modules, so the service crash-looped on staging with
# ERR_MODULE_NOT_FOUND for better-auth (run #48 image, dist/auth.js:13).
# Same failure mode + fix as apps/platform-api (@fastify/helmet, proven
# live). The runner has no other workspaces, so flattening cannot conflict.
RUN if [ -d apps/auth-service/node_modules ]; then cp -r apps/auth-service/node_modules/. node_modules/; fi
COPY apps/auth-service apps/auth-service
WORKDIR /app/apps/auth-service
RUN npx prisma generate
RUN npm run build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/auth-service/dist ./dist
COPY --from=builder /app/apps/auth-service/prisma ./prisma
COPY --from=builder /app/apps/auth-service/prisma.config.ts ./
COPY --from=builder /app/apps/auth-service/package.json ./
# Runtime-presence gate: a green build must mean a runnable image. Import
# every external package dist/ needs (see src/ imports) from the runner
# layout (/app/node_modules only). If any is missing — e.g. a dep npm nests
# under a workspace instead of hoisting to the root — the build FAILS here,
# before the image is pushed. This is the check that would have caught the
# better-auth crash-loop (run #48 image) at build time instead of on staging.
RUN node --input-type=module -e "for (const m of ['better-auth', 'better-auth/crypto', 'better-auth/adapters/prisma', 'better-auth/cookies', 'better-auth/plugins/organization', 'better-auth/plugins/two-factor', 'better-auth/plugins/email-otp', '@better-auth/prisma-adapter', '@better-auth/core', '@better-auth/utils', '@prisma/adapter-pg', '@prisma/client-runtime-utils', '@prisma/debug', 'bcryptjs', 'nodemailer', 'pg']) { await import(m); console.log('runtime dep ok:', m); }"
USER nestjs
EXPOSE 4200
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4200/health || exit 1
CMD ["node", "dist/index.js"]
