-- WooCommerce product import (§10.3, §10.5) — SyncRun fan-out fields.
--
-- ADDITION beyond the §22 inventory, required by the design as written:
-- §10.3 says a page job's child run carries `parentRunId = batch run`,
-- but SyncRun had no such column (the sync-all fan-out keeps no parent
-- link at all); §10.5 says retry re-runs FAILED items from "their
-- decisions stored on the batch run", but SyncRun had no JSON home for
-- them. Both columns are nullable and additive; every non-import run
-- leaves them NULL.
--
-- parentRunId: child run → batch run link (completion sweep + the
-- server-side count-by-reason query aggregate over batch + children).
-- metadata: batch-run JSON `{ import: { publishMode, categoryMode,
-- categoryId, bringStock, skipImages, idempotencyKey, pageCount,
-- imageJobsTotal, decisions } }` — run options + decisions for retry,
-- and the idempotency key for double-confirm dedup.

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN "parentRunId" TEXT;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "SyncRun_tenant_id_parentRunId_idx" ON "SyncRun"("tenant_id", "parentRunId");
