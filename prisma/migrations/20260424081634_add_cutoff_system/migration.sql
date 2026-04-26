-- Cut-Off Accounting Boundary System Migration
-- Additive only: no existing columns removed or renamed
-- Safe to apply to production

-- CreateEnum
CREATE TYPE "CutoffStatus" AS ENUM ('DRAFT', 'VALIDATED', 'APPLIED', 'SUPERSEDED');

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'SuperAdmin';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "group" TEXT;

-- CreateTable
CREATE TABLE "CutoffRevision" (
    "id" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "cutoffDate" DATE NOT NULL,
    "status" "CutoffStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationReport" JSONB,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "appliedByName" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersededByRevisionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutoffRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "suggestedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningInventorySnapshot" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lotCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningInventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningInventoryLot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningInventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningWipEntry" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "currentStep" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningWipEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CutoffAuditLog" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "performedById" TEXT,
    "performedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CutoffAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CutoffRevision_status_idx" ON "CutoffRevision"("status");

-- CreateIndex
CREATE INDEX "CutoffRevision_cutoffDate_idx" ON "CutoffRevision"("cutoffDate");

-- CreateIndex
CREATE INDEX "OpeningBalance_revisionId_idx" ON "OpeningBalance"("revisionId");

-- CreateIndex
CREATE INDEX "OpeningBalance_entityType_entityId_idx" ON "OpeningBalance"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_revisionId_entityType_entityId_key" ON "OpeningBalance"("revisionId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "OpeningInventorySnapshot_revisionId_idx" ON "OpeningInventorySnapshot"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningInventorySnapshot_revisionId_productId_variantId_key" ON "OpeningInventorySnapshot"("revisionId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "OpeningInventoryLot_snapshotId_idx" ON "OpeningInventoryLot"("snapshotId");

-- CreateIndex
CREATE INDEX "OpeningWipEntry_revisionId_idx" ON "OpeningWipEntry"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningWipEntry_revisionId_productId_variantId_key" ON "OpeningWipEntry"("revisionId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "CutoffAuditLog_revisionId_idx" ON "CutoffAuditLog"("revisionId");

-- CreateIndex
CREATE INDEX "CutoffAuditLog_createdAt_idx" ON "CutoffAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CutoffRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningInventorySnapshot" ADD CONSTRAINT "OpeningInventorySnapshot_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CutoffRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningInventoryLot" ADD CONSTRAINT "OpeningInventoryLot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OpeningInventorySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningWipEntry" ADD CONSTRAINT "OpeningWipEntry_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CutoffRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutoffAuditLog" ADD CONSTRAINT "CutoffAuditLog_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CutoffRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: Tag default liquid accounts
UPDATE "Account" SET "group" = 'LIQUID' WHERE LOWER("name") IN ('cash', 'bank', 'bkash', 'nagad', 'rocket') AND "group" IS NULL;
