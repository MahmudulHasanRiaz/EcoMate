-- CreateEnum
CREATE TYPE "FabricPart" AS ENUM ('JAMA', 'ORNA', 'SELOWAR');

-- CreateTable
CREATE TABLE "FabricLotUsage" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "part" "FabricPart" NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "yards" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FabricLotUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FabricLotUsage_poId_idx" ON "FabricLotUsage"("poId");

-- CreateIndex
CREATE INDEX "FabricLotUsage_itemId_idx" ON "FabricLotUsage"("itemId");

-- CreateIndex
CREATE INDEX "FabricLotUsage_inventoryItemId_idx" ON "FabricLotUsage"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "FabricLotUsage" ADD CONSTRAINT "FabricLotUsage_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricLotUsage" ADD CONSTRAINT "FabricLotUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricLotUsage" ADD CONSTRAINT "FabricLotUsage_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
