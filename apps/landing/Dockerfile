FROM node:24.22.1-alpine AS builder
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
# Rewrite target for the same-origin /api/* proxy (next.config.ts).
# BUILD-TIME, not runtime: Next.js bakes the rewrite destination into
# routes-manifest.json during `next build`; the standalone server does NOT
# re-read next.config at boot, so a runtime PLATFORM_API_URL cannot move
# the rewrite (proven live 2026-11-17 — a runtime override was ignored and
# the baked platform-api:4100 target was used). To point the rewrite at a
# different platform API, rebuild with a different ARG value. The default
# is the deployed topology's internal address, which resolves on the
# compose network. (Runtime PLATFORM_API_URL is still read by server code
# — lib/plans.ts fetches plans through it — just not by the rewrite.)
# In production the rewrite is a fallback anyway: Caddy routes /api/* on
# the www host straight to platform-api before the landing sees it.
ARG PLATFORM_API_URL=http://platform-api:4100/api
ENV PLATFORM_API_URL=${PLATFORM_API_URL}
WORKDIR /app
COPY package*.json ./
COPY apps/landing/package.json apps/landing/package.json
RUN --mount=type=cache,target=/root/.npm npm install
COPY apps/landing apps/landing
WORKDIR /app/apps/landing
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind all interfaces: Docker auto-sets HOSTNAME to the container ID (which
# resolves to the container IP), so without this the standalone server
# listens on the container IP ONLY and the localhost healthcheck gets
# connection refused (false unhealthy).
ENV HOSTNAME=0.0.0.0
# The standalone server reads PORT (default 3000); the landing app serves
# on 3002. Compose does not override this.
ENV PORT=3002
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
# Standalone output: apps/landing/server.js + node_modules/ at root
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/standalone ./
# Static assets go next to server.js (monorepo path). There is no public/
# directory in the landing app (no COPY for it — COPY of a missing source
# fails the build).
COPY --from=builder --chown=nextjs:nodejs /app/apps/landing/.next/static ./apps/landing/.next/static
COPY --chown=nextjs:nodejs apps/landing/startup.sh ./apps/landing/startup.sh
USER nextjs
EXPOSE 3002
# NOTE: the probe uses 127.0.0.1, NOT localhost — BusyBox wget resolves
# localhost to ::1 first with no fallback, and the server is IPv4-only.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3002/api/health || exit 1
CMD ["sh", "apps/landing/startup.sh"]
