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
USER nestjs
EXPOSE 4200
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4200/health || exit 1
CMD ["node", "dist/index.js"]
