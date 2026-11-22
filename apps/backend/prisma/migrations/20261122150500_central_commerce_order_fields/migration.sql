-- Central Commerce (Phase 9) — cross-cutting Order fields (P6 provenance + P8 channels).
-- Every new table carries tenant_id + tenant-first indexes + RLS
-- (ENABLE + FORCE + tenant_isolation policy + tenant_id_guard trigger)
-- in its FIRST migration (§3.12.2). The `rls_coverage` view + boot gate
-- refuse to start if any of those is missing.
--
-- The ~200 `ALTER COLUMN "tenant_id" SET DEFAULT` statements Prisma's
-- diff engine also generates are stripped deliberately (see
-- 20261122150000_central_commerce_enums): Postgres normalizes '' to
-- ''::text on store, so they can never converge and change nothing.


-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "externalOrderId" TEXT,
ADD COLUMN     "ingestFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "marketingChannel" "MarketingChannel",
ADD COLUMN     "salesChannelType" "SalesChannelType",
ADD COLUMN     "showroomId" TEXT,
ADD COLUMN     "storeId" TEXT,
ADD COLUMN     "storeMetadata" JSONB;

-- CreateIndex
CREATE INDEX "Order_tenant_id_storeId_idx" ON "Order"("tenant_id", "storeId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_externalOrderId_idx" ON "Order"("tenant_id", "externalOrderId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_salesChannelType_idx" ON "Order"("tenant_id", "salesChannelType");

-- CreateIndex
CREATE INDEX "Order_tenant_id_showroomId_idx" ON "Order"("tenant_id", "showroomId");

-- CreateIndex
CREATE INDEX "Order_tenant_id_marketingChannel_idx" ON "Order"("tenant_id", "marketingChannel");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
