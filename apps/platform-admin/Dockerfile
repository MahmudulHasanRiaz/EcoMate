FROM node:24.22.1-alpine AS builder
# Absolute platform API base baked into the bundle. Default empty =
# same-origin /api (Caddy routes /api on the saas. host to platform-api,
# so no origin is baked into the image).
ARG VITE_PLATFORM_API_URL=
ENV VITE_PLATFORM_API_URL=${VITE_PLATFORM_API_URL}
WORKDIR /app
COPY package*.json ./
COPY apps/platform-admin/package.json apps/platform-admin/package.json
RUN --mount=type=cache,target=/root/.npm npm install
COPY apps/platform-admin apps/platform-admin
WORKDIR /app/apps/platform-admin
RUN npm run build

FROM nginx:stable-alpine AS runner
# Served at the ROOT of its own host (saas.ecomate.bd) — NOT under a
# subpath like /admin/.
COPY --from=builder /app/apps/platform-admin/dist /usr/share/nginx/html
COPY apps/platform-admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
