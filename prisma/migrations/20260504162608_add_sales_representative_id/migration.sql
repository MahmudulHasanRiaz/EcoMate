/*
  Warnings:

  - You are about to drop the column `endedAt` on the `MarketingCampaign` table. All the data in the column will be lost.
  - You are about to drop the column `platform` on the `MarketingCampaign` table. All the data in the column will be lost.
  - You are about to drop the column `targetCpaBdt` on the `MarketingCampaign` table. All the data in the column will be lost.
  - You are about to drop the column `targetCpaUsd` on the `MarketingCampaign` table. All the data in the column will be lost.
  - You are about to drop the column `amountBdt` on the `MarketingSpend` table. All the data in the column will be lost.
  - You are about to drop the column `amountUsd` on the `MarketingSpend` table. All the data in the column will be lost.
  - You are about to drop the column `fxRate` on the `MarketingSpend` table. All the data in the column will be lost.
  - Made the column `autoSyncEnabled` on table `WooCommerceIntegration` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "StaffIncomeAction" ADD VALUE 'Manual';

-- DropForeignKey
ALTER TABLE "CashDrawerAdjustment" DROP CONSTRAINT "CashDrawerAdjustment_cashDrawerId_fkey";

-- DropForeignKey
ALTER TABLE "CashDrawerSession" DROP CONSTRAINT "CashDrawerSession_cashDrawerId_fkey";

-- DropForeignKey
ALTER TABLE "Showroom" DROP CONSTRAINT "Showroom_cashDrawerId_fkey";

-- DropForeignKey
ALTER TABLE "Showroom" DROP CONSTRAINT "Showroom_locationId_fkey";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "salesRepresentativeId" TEXT;

-- AlterTable
ALTER TABLE "MarketingCampaign" DROP COLUMN "endedAt",
DROP COLUMN "platform",
DROP COLUMN "targetCpaBdt",
DROP COLUMN "targetCpaUsd";

-- AlterTable
ALTER TABLE "MarketingSpend" DROP COLUMN "amountBdt",
DROP COLUMN "amountUsd",
DROP COLUMN "fxRate";

-- AlterTable
ALTER TABLE "WooCommerceIntegration" ALTER COLUMN "autoSyncEnabled" SET NOT NULL;

-- DropEnum
DROP TYPE "MarketingPlatform";

-- CreateTable
CREATE TABLE "DatabaseBackupLog" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DatabaseBackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_salesRepresentativeId_idx" ON "Customer"("salesRepresentativeId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salesRepresentativeId_fkey" FOREIGN KEY ("salesRepresentativeId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showroom" ADD CONSTRAINT "Showroom_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showroom" ADD CONSTRAINT "Showroom_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerAdjustment" ADD CONSTRAINT "CashDrawerAdjustment_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
