-- Webhook failure table (Phase 9 webhook fix, G-16 + J-05/J-11).
--
-- NEW table StoreWebhookFailure: one row per failed-delivery identity,
-- upserted by `deliveryKey` where available, else by (store, reason,
-- day bucket). Reasons (plain String, no enum — new reasons must never
-- need a migration): SIGNATURE_MISMATCH, NO_SECRET, UNKNOWN_STORE,
-- MISSING_DELIVERY_ID, ENQUEUE_FAILED, INGEST_FAILED,
-- AUTO_SYNC_DISABLED. `storeId` is NULLABLE: UNKNOWN_STORE rows, by
-- definition, have no store row to reference.
--
-- Standard tenant treatment (§3.12.2): tenant_id + tenant-first indexes +
-- RLS (ENABLE + FORCE + tenant_isolation policy + tenant_id_guard trigger)
-- in its FIRST migration. The `rls_coverage` view + boot gate refuse to
-- start if any of those is missing.
--
-- New enum WebhookFailureStatus is created in this same migration: the
-- enum-ADD-VALUE rule (never share a migration with DML using the new
-- value) applies to ADD VALUE on an existing enum, not to creating a
-- brand-new type alongside its first table — no DML runs here at all.

-- CreateEnum
CREATE TYPE "WebhookFailureStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "StoreWebhookFailure" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "deliveryKey" TEXT,
    "topic" TEXT,
    "reason" TEXT NOT NULL,
    "status" "WebhookFailureStatus" NOT NULL DEFAULT 'OPEN',
    "payload" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StoreWebhookFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreWebhookFailure_deliveryKey_key" ON "StoreWebhookFailure"("deliveryKey");

-- CreateIndex
CREATE INDEX "StoreWebhookFailure_tenant_id_storeId_idx" ON "StoreWebhookFailure"("tenant_id", "storeId");

-- CreateIndex
CREATE INDEX "StoreWebhookFailure_tenant_id_status_lastSeenAt_idx" ON "StoreWebhookFailure"("tenant_id", "status", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "StoreWebhookFailure" ADD CONSTRAINT "StoreWebhookFailure_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreWebhookFailure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreWebhookFailure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreWebhookFailure";
CREATE POLICY tenant_isolation ON "StoreWebhookFailure"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreWebhookFailure";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreWebhookFailure"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- App-role grant (same shape as the Phase 9 migrations: the runtime role
-- is NOSUPERUSER/NOBYPASSRLS, so without this every failure read/write
-- fails with `permission denied for table StoreWebhookFailure`).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "StoreWebhookFailure" TO ecomate_app';
  END IF;
END $$;
