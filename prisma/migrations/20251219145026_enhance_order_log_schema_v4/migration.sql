/*
  Warnings:

  - The primary key for the `ComboProductItem` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `platform` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `cuttingDamagedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `cuttingReceivedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `cuttingVendorId` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `fabricDamagedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `fabricSentQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `finalDamagedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `printingDamagedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `printingReceivedQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `printingSentQty` on the `PurchaseOrder` table. All the data in the column will be lost.
  - You are about to drop the column `printingVendorId` on the `PurchaseOrder` table. All the data in the column will be lost.
  - The `status` column on the `StaffInvite` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `rate` on the `Vendor` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[parentId,childId,variantId]` on the table `ComboProductItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProductionStepType" AS ENUM ('FABRIC', 'PRINTING', 'CUTTING', 'FINISHING');

-- CreateEnum
CREATE TYPE "ProductionCurrentStep" AS ENUM ('PLANNING', 'FABRIC', 'PRINTING', 'CUTTING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('Pending', 'Accepted', 'Revoked');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('Open', 'In Progress', 'Resolved', 'Closed');

-- CreateEnum
CREATE TYPE "IssuePriority" AS ENUM ('Low', 'Medium', 'High');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'Draft';

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_cuttingVendorId_fkey";

-- DropForeignKey
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_printingVendorId_fkey";

-- DropIndex
DROP INDEX "ComboProductItem_variantId_idx";

-- DropIndex
DROP INDEX "OrderProduct_sku_idx";

-- AlterTable
ALTER TABLE "ComboProductItem" DROP CONSTRAINT "ComboProductItem_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "ComboProductItem_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "source" TEXT,
DROP COLUMN "platform",
ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "OrderLog" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" DROP COLUMN "cuttingDamagedQty",
DROP COLUMN "cuttingReceivedQty",
DROP COLUMN "cuttingVendorId",
DROP COLUMN "fabricDamagedQty",
DROP COLUMN "fabricSentQty",
DROP COLUMN "finalDamagedQty",
DROP COLUMN "printingDamagedQty",
DROP COLUMN "printingReceivedQty",
DROP COLUMN "printingSentQty",
DROP COLUMN "printingVendorId",
ADD COLUMN     "currentStep" "ProductionCurrentStep" NOT NULL DEFAULT 'PLANNING';

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "cuttingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "finalQty" INTEGER,
ADD COLUMN     "jamaRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "jamaYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ornaRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ornaYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "printingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "selowarRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "selowarYards" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "PurchasePayment" ADD COLUMN     "productionStepId" TEXT;

-- AlterTable
ALTER TABLE "StaffInvite" DROP COLUMN "status",
ADD COLUMN     "status" "InviteStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "Vendor" DROP COLUMN "rate";

-- AlterTable
ALTER TABLE "WooCommerceIntegration" ADD COLUMN     "webhookSecret" TEXT,
ADD COLUMN     "webhookUrl" TEXT;

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionStep" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "stepType" "ProductionStepType" NOT NULL,
    "vendorId" TEXT,
    "costAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outputQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastageQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pindiOfFab" INTEGER,
    "invoiceUrl" TEXT,
    "generatedInvoiceNumber" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProductionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'Open',
    "priority" "IssuePriority" NOT NULL DEFAULT 'Medium',
    "createdBy" TEXT NOT NULL,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLog" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "IssueLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionStep_poId_stepType_key" ON "ProductionStep"("poId", "stepType");

-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");

-- CreateIndex
CREATE INDEX "Issue_priority_idx" ON "Issue"("priority");

-- CreateIndex
CREATE INDEX "Issue_orderId_idx" ON "Issue"("orderId");

-- CreateIndex
CREATE INDEX "Issue_assignedTo_idx" ON "Issue"("assignedTo");

-- CreateIndex
CREATE UNIQUE INDEX "ComboProductItem_parentId_childId_variantId_key" ON "ComboProductItem"("parentId", "childId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryMovement_timestamp_idx" ON "InventoryMovement"("timestamp");

-- CreateIndex
CREATE INDEX "Order_platform_idx" ON "Order"("platform");

-- CreateIndex
CREATE INDEX "OrderLog_orderId_idx" ON "OrderLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderLog_userId_idx" ON "OrderLog"("userId");

-- CreateIndex
CREATE INDEX "OrderProduct_orderId_productId_idx" ON "OrderProduct"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_productionStepId_fkey" FOREIGN KEY ("productionStepId") REFERENCES "ProductionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLog" ADD CONSTRAINT "IssueLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
