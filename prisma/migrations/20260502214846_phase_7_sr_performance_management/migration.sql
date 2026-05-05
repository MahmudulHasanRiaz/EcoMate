-- Phase 7: SR Performance Management
-- Additive migration - no destructive changes

-- CreateEnum
CREATE TYPE "SrTargetStatus" AS ENUM ('Active', 'Completed', 'Expired', 'Cancelled');
CREATE TYPE "SrTargetType" AS ENUM ('SalesAmount', 'Quantity');
CREATE TYPE "SrIncentiveType" AS ENUM ('CommissionRate', 'FlatBonus');
CREATE TYPE "SrCommissionStatus" AS ENUM ('Accrued', 'Confirmed', 'Voided');

-- CreateTable: SrIncentivePolicy (must exist before SrTarget FK)
CREATE TABLE "SrIncentivePolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "incentiveType" "SrIncentiveType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SrIncentivePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SrTarget
CREATE TABLE "SrTarget" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SrTargetType" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "SrTargetStatus" NOT NULL DEFAULT 'Active',
    "incentivePolicyId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SrTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SrCommissionLog
CREATE TABLE "SrCommissionLog" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "targetId" TEXT,
    "policyId" TEXT,
    "orderTotal" DOUBLE PRECISION NOT NULL,
    "commissionRate" DOUBLE PRECISION,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "status" "SrCommissionStatus" NOT NULL DEFAULT 'Accrued',
    "accrualNote" TEXT,
    "voidReason" TEXT,
    "accrualDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SrCommissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SrIncentivePolicy_isActive_idx" ON "SrIncentivePolicy"("isActive");

CREATE INDEX "SrTarget_staffId_status_idx" ON "SrTarget"("staffId", "status");
CREATE INDEX "SrTarget_staffId_startDate_endDate_idx" ON "SrTarget"("staffId", "startDate", "endDate");
CREATE INDEX "SrTarget_status_idx" ON "SrTarget"("status");

CREATE INDEX "SrCommissionLog_staffId_status_idx" ON "SrCommissionLog"("staffId", "status");
CREATE INDEX "SrCommissionLog_staffId_accrualDate_idx" ON "SrCommissionLog"("staffId", "accrualDate");
CREATE INDEX "SrCommissionLog_orderId_idx" ON "SrCommissionLog"("orderId");
CREATE INDEX "SrCommissionLog_targetId_idx" ON "SrCommissionLog"("targetId");

-- AddForeignKey
ALTER TABLE "SrTarget" ADD CONSTRAINT "SrTarget_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SrTarget" ADD CONSTRAINT "SrTarget_incentivePolicyId_fkey" FOREIGN KEY ("incentivePolicyId") REFERENCES "SrIncentivePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SrCommissionLog" ADD CONSTRAINT "SrCommissionLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
