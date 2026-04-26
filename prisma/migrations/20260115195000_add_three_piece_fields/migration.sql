-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "printingDamagedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "cuttingDamagedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "finishingWastageQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductionStep" ADD COLUMN "note" TEXT;
