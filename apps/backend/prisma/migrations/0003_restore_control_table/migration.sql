-- Phase 8, Stage 2 (item 22/23): create the restore-control journal that
-- BackupService has always read and written but nothing ever created.
--
-- Background: BackupService (backup.service.ts) guards every backup with a
-- SELECT on "ecomate_control"."backup_restore_operation" (getActiveRestoreControl)
-- and journals every restore through INSERT/UPDATE/DELETE on the same table,
-- but no migration, bootstrap, or seed ever created the schema or the table.
-- On any fresh database (a fresh staging deploy, the test env) the first
-- scheduled backup failed with 42P01 (relation does not exist) and restores
-- could not run at all. Found live 2026-11-17 during the Phase 8 restore drill.
--
-- The table lives outside the "public" schema on purpose: pg_dump of the
-- tenant DB excludes "ecomate_control" (backup.service.ts passes
-- --exclude-schema=ecomate_control), so a restore never resurrects a stale
-- "restore in progress" journal row from the backup itself.
--
-- Columns mirror exactly what the service reads/writes:
--   operation_id      -- the BackupJob id of the restore being journaled
--   phase             -- 'preparing' | 'database_committed' | 'failed_after_commit'
--   execution_role    -- DB role the restore ran as (NULL when unknown)
--   source_snapshot   -- serialized BackupJob snapshot (jsonb, NULL until saved)
--   catalog_snapshots -- per-catalog snapshots (jsonb, NULL until saved)
--   updated_at        -- last journal write (clock_timestamp(), not now())
--
-- Grants: the migration user owns the table. The non-superuser app roles
-- used by the backend in test (ecomate_tenant_app) and in compose
-- (ecomate_app) get full DML when they exist; in production the backend's
-- DATABASE_URL is the postgres superuser and needs no grant. The DO blocks
-- are conditional so the migration also applies on databases where neither
-- role exists yet.

CREATE SCHEMA IF NOT EXISTS "ecomate_control";

CREATE TABLE IF NOT EXISTS "ecomate_control"."backup_restore_operation" (
  "operation_id" text PRIMARY KEY,
  "phase" text NOT NULL
    CHECK ("phase" IN ('preparing', 'database_committed', 'failed_after_commit')),
  "execution_role" text,
  "source_snapshot" jsonb,
  "catalog_snapshots" jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_tenant_app') THEN
    GRANT USAGE ON SCHEMA "ecomate_control" TO ecomate_tenant_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ecomate_control"."backup_restore_operation" TO ecomate_tenant_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    GRANT USAGE ON SCHEMA "ecomate_control" TO ecomate_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ecomate_control"."backup_restore_operation" TO ecomate_app;
  END IF;
END
$$;
