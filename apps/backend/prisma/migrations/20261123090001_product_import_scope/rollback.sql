-- Rollback for 20261123090001_product_import_scope.
-- Postgres cannot remove a single enum value; the value is dropped by
-- recreating the enum without it. Only run when no SyncRun row uses
-- PRODUCT_IMPORT (the DELETE guard below fails the rollback otherwise —
-- delete or re-scope those runs first, deliberately, by hand).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SyncRun" WHERE scope = 'PRODUCT_IMPORT') THEN
    RAISE EXCEPTION 'rollback refused: SyncRun rows still use PRODUCT_IMPORT';
  END IF;
END $$;
ALTER TYPE "SyncRunScope" RENAME TO "SyncRunScope_old";
CREATE TYPE "SyncRunScope" AS ENUM ('PRODUCT', 'STOCK', 'ORDER_INGEST', 'ORDER_PUSH', 'RECONCILE', 'MAINTENANCE', 'PUBLISH');
ALTER TABLE "SyncRun" ALTER COLUMN "scope" TYPE "SyncRunScope" USING "scope"::text::"SyncRunScope";
DROP TYPE "SyncRunScope_old";
