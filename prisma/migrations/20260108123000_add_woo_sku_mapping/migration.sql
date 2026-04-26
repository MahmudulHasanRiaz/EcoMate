/*
  Warnings:

  - Added the required table `WooSkuMapping`.
*/
-- CreateTable
CREATE TABLE "WooSkuMapping" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WooSkuMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WooSkuMapping_integrationId_sku_key" ON "WooSkuMapping"("integrationId", "sku");
CREATE INDEX "WooSkuMapping_integrationId_idx" ON "WooSkuMapping"("integrationId");
CREATE INDEX "WooSkuMapping_sku_idx" ON "WooSkuMapping"("sku");

-- AddForeignKey
ALTER TABLE "WooSkuMapping" ADD CONSTRAINT "WooSkuMapping_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
