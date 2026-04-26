-- AlterTable
ALTER TABLE "ProductionStep" ADD COLUMN     "fabricInventoryId" TEXT;

-- AlterTable
ALTER TABLE "_StaffBusinessAccess" ADD CONSTRAINT "_StaffBusinessAccess_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_StaffBusinessAccess_AB_unique";

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_fabricInventoryId_fkey" FOREIGN KEY ("fabricInventoryId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
