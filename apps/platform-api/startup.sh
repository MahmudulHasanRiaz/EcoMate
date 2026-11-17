#!/bin/sh
set -e

# Platform API startup: create the platform database if needed, apply
# platform migrations FIRST (master plan §10.3 deploy order: platform DB
# migration -> tenant DB migration -> app rollout), optionally seed, start.
#
# Why the database is created here instead of a postgres init script: a
# bind-mounted init script broke a Portainer git-stack deploy before
# (docker-compose.yml: media-static comment), and a custom postgres image
# is an extra build to maintain. This step is idempotent and reuses the
# postgresql-client pattern from the backend image.

if [ -z "$PLATFORM_DATABASE_URL" ]; then
  echo "[Startup] ERROR: PLATFORM_DATABASE_URL is not set"
  exit 1
fi

# Derive the admin DSN (same host/credentials, database `postgres`) and the
# target database name from PLATFORM_DATABASE_URL, so a renamed platform
# database still works. The name is restricted to safe identifier
# characters — anything else fails closed instead of reaching psql.
DB_URL_NO_QUERY="${PLATFORM_DATABASE_URL%%\?*}"
PLATFORM_DB="${DB_URL_NO_QUERY##*/}"
case "$PLATFORM_DB" in
  ''|*[!a-zA-Z0-9_]*)
    echo "[Startup] ERROR: cannot derive a safe database name from PLATFORM_DATABASE_URL"
    exit 1
    ;;
esac
ADMIN_URL="${DB_URL_NO_QUERY%/*}/postgres"

echo "[Startup] Ensuring platform database '${PLATFORM_DB}' exists..."
if ! psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '${PLATFORM_DB}'" | grep -q 1; then
  echo "[Startup] Creating database '${PLATFORM_DB}'..."
  psql "$ADMIN_URL" -c "CREATE DATABASE \"${PLATFORM_DB}\""
fi

echo "[Startup] Applying platform migrations..."
npx prisma migrate deploy 2>&1
echo "[Startup] Migrations applied successfully"

# The seed is idempotent (upserts), so an accidental re-run is safe — but
# it only runs when the stack explicitly asks for it (first deploy).
if [ "$RUN_PLATFORM_SEED" = "true" ]; then
  echo "[Startup] Running platform seeding..."
  # Run tsx directly instead of `npx prisma db seed`: the package.json seed
  # script first rebuilds @ecomate/shared-types from ../../packages, a path
  # that does not exist in this flattened runner image. The built package
  # is already present (dereferenced into node_modules by the Dockerfile).
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts
fi

# Tenant export directory (TENANT_EXPORT_DIR, compose mounts the
# platform-exports-data volume here). The server runs as nestjs (1001).
echo "[Startup] Ensuring tenant export directory permissions..."
EXPORT_DIR="${TENANT_EXPORT_DIR:-/app/data/tenant-exports}"
mkdir -p "$EXPORT_DIR"
chown -R 1001:1001 "$EXPORT_DIR"

echo "[Startup] Starting server..."
exec su -s /bin/sh nestjs -c "exec node dist/src/main"
