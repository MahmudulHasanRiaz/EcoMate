#!/bin/bash
# EcoMate Database Backup Script (SaaS)
# Dumps BOTH databases: the tenant database (default: ecomate) and the
# platform database (default: ecomate_platform — tenants, plans,
# subscriptions, invoices, payments; losing it is unrecoverable).
#
# Usage: bash scripts/backup-db.sh
#   Env overrides: DB_HOST (default localhost), DB_USER (default postgres),
#   TENANT_DB (default ecomate), PLATFORM_DB (default ecomate_platform),
#   BACKUP_DIR (default ./backups).
#
# Requires pg_dump on PATH and a reachable Postgres. The compose stack does
# not publish the Postgres port, so run this on the VPS host against a
# published port, or from inside the stack:
#   docker compose exec -T postgres pg_dump -U postgres -d ecomate > ...
set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-postgres}"
TENANT_DB="${TENANT_DB:-ecomate}"
PLATFORM_DB="${PLATFORM_DB:-ecomate_platform}"

mkdir -p "$BACKUP_DIR"

TENANT_BACKUP="$BACKUP_DIR/ecomate_backup_$TIMESTAMP.sql"
PLATFORM_BACKUP="$BACKUP_DIR/ecomate_platform_backup_$TIMESTAMP.sql"

echo "Backing up tenant DB $TENANT_DB to $TENANT_BACKUP..."
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$TENANT_DB" > "$TENANT_BACKUP"

echo "Backing up platform DB $PLATFORM_DB to $PLATFORM_BACKUP..."
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$PLATFORM_DB" > "$PLATFORM_BACKUP"

# Keep only last 7 days of backups (both databases)
find "$BACKUP_DIR" -name "ecomate_backup_*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "ecomate_platform_backup_*.sql" -mtime +7 -delete

echo "Backup complete."
echo "  Tenant:   $TENANT_BACKUP"
echo "  Platform: $PLATFORM_BACKUP"
echo "Backups directory: $(ls "$BACKUP_DIR" | wc -l | tr -d ' ') files"
