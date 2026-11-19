-- Dynamic pricing engine (design: pricing-engine-design.md §5, §12).
-- DDL ONLY: creates the InvoiceKind enum in FULL (SUBSCRIPTION, ONE_TIME,
-- METERED, MANUAL, TOPUP — TOPUP is created here so the SMTP top-up
-- migration never has to add it), the purchase enums, the pricing columns
-- and the three new tables. Data backfill lives in the next migration
-- (20261118155700_pricing_engine_backfill) — enum creation and DML using
-- the new values never share a file.

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('SUBSCRIPTION', 'ONE_TIME', 'METERED', 'MANUAL', 'TOPUP');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('SETUP_FEE', 'LIMIT_INCREASE', 'RATE_TIER', 'FEATURE_UNLOCK');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'APPLIED', 'CANCELLED');

-- AlterTable
ALTER TABLE "PlanVersion" ADD COLUMN "pricing" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "freePeriodsRemaining" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AddOn" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "metering" JSONB;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "TenantPricingOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPricingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPurchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "type" "PurchaseType" NOT NULL,
    "feeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "effect" JSONB NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceId" TEXT,
    "createdBy" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantBlockingOverride" (
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "blockedAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBlockingOverride_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPricingOverride_tenantId_key_key" ON "TenantPricingOverride"("tenantId", "key");

-- CreateIndex
CREATE INDEX "TenantPricingOverride_key_idx" ON "TenantPricingOverride"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPurchase_invoiceId_key" ON "TenantPurchase"("invoiceId");

-- CreateIndex
CREATE INDEX "TenantPurchase_tenantId_status_idx" ON "TenantPurchase"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantPurchase_subscriptionId_idx" ON "TenantPurchase"("subscriptionId");

-- CreateIndex
CREATE INDEX "Invoice_kind_status_createdAt_idx" ON "Invoice"("kind", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantPricingOverride" ADD CONSTRAINT "TenantPricingOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPurchase" ADD CONSTRAINT "TenantPurchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPurchase" ADD CONSTRAINT "TenantPurchase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPurchase" ADD CONSTRAINT "TenantPurchase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantBlockingOverride" ADD CONSTRAINT "TenantBlockingOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
