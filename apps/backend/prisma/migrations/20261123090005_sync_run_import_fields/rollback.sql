-- Rollback for 20261123090005_sync_run_import_fields.
DROP INDEX IF EXISTS "SyncRun_tenant_id_parentRunId_idx";
ALTER TABLE "SyncRun" DROP COLUMN IF EXISTS "metadata";
ALTER TABLE "SyncRun" DROP COLUMN IF EXISTS "parentRunId";
