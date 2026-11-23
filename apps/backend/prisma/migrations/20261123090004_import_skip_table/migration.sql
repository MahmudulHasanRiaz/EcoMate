-- WooCommerce product import (§22 item 4, §14.2 gap 3, §3.4) — skip table.
--
-- NEW table StoreProductImportSkip: the persisted per-(store, remote
-- product) SKIP decision. A skipped product has NO mapping — that is the
-- point — so the skip is its own row, not a flag on the mapping. Skipped
-- products are hidden from the review table by default until unskipped.
--
-- Standard tenant treatment (§3.12.2): tenant_id + tenant-first indexes +
-- RLS (ENABLE + FORCE + tenant_isolation policy + tenant_id_guard trigger)
-- in its FIRST migration. The `rls_coverage` view + boot gate refuse to
-- start if any of those is missing.

-- CreateTable
CREATE TABLE "StoreProductImportSkip" (
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "note" TEXT,
    "skippedBy" TEXT,
    "skippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreProductImportSkip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreProductImportSkip_storeId_externalId_key" ON "StoreProductImportSkip"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "StoreProductImportSkip_tenant_id_idx" ON "StoreProductImportSkip"("tenant_id");

-- CreateIndex
CREATE INDEX "StoreProductImportSkip_tenant_id_storeId_idx" ON "StoreProductImportSkip"("tenant_id", "storeId");

-- AddForeignKey
ALTER TABLE "StoreProductImportSkip" ADD CONSTRAINT "StoreProductImportSkip_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "StoreProductImportSkip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreProductImportSkip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StoreProductImportSkip";
CREATE POLICY tenant_isolation ON "StoreProductImportSkip"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "StoreProductImportSkip";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "StoreProductImportSkip"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();
