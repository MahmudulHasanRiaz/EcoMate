-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('Percentage', 'FlatAmount', 'PerQuantity');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateTable
CREATE TABLE "WholesalePricingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "minTotalQuantity" INTEGER,
    "minSubtotal" DOUBLE PRECISION,
    "minGrandTotal" DOUBLE PRECISION,
    "sourcePlatforms" TEXT[],
    "customerTypes" "CustomerType"[],
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "maxDiscountAmount" DOUBLE PRECISION,
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesalePricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesalePricingTier" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "minAmount" DOUBLE PRECISION,
    "maxAmount" DOUBLE PRECISION,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "tierOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesalePricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SrDiscountPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "staffId" TEXT,
    "maxDiscountPercent" DOUBLE PRECISION,
    "maxDiscountAmount" DOUBLE PRECISION,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvalThresholdPct" DOUBLE PRECISION,
    "approvalThresholdAmt" DOUBLE PRECISION,
    "requiresActiveTarget" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SrDiscountPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDiscountApprovalLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedDiscount" DOUBLE PRECISION NOT NULL,
    "discountType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "appliedDiscount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDiscountApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesalePricingRule_name_key" ON "WholesalePricingRule"("name");

-- CreateIndex
CREATE INDEX "WholesalePricingRule_priority_idx" ON "WholesalePricingRule"("priority");

-- CreateIndex
CREATE INDEX "WholesalePricingRule_isActive_idx" ON "WholesalePricingRule"("isActive");

-- CreateIndex
CREATE INDEX "WholesalePricingRule_businessId_idx" ON "WholesalePricingRule"("businessId");

-- CreateIndex
CREATE INDEX "WholesalePricingTier_ruleId_idx" ON "WholesalePricingTier"("ruleId");

-- CreateIndex
CREATE INDEX "WholesalePricingTier_tierOrder_idx" ON "WholesalePricingTier"("tierOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SrDiscountPolicy_name_key" ON "SrDiscountPolicy"("name");

-- CreateIndex
CREATE INDEX "SrDiscountPolicy_staffId_idx" ON "SrDiscountPolicy"("staffId");

-- CreateIndex
CREATE INDEX "SrDiscountPolicy_isActive_idx" ON "SrDiscountPolicy"("isActive");

-- CreateIndex
CREATE INDEX "OrderDiscountApprovalLog_orderId_idx" ON "OrderDiscountApprovalLog"("orderId");

-- CreateIndex
CREATE INDEX "OrderDiscountApprovalLog_status_idx" ON "OrderDiscountApprovalLog"("status");

-- CreateIndex
CREATE INDEX "OrderDiscountApprovalLog_createdAt_idx" ON "OrderDiscountApprovalLog"("createdAt");

-- AddForeignKey
ALTER TABLE "WholesalePricingRule" ADD CONSTRAINT "WholesalePricingRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesalePricingTier" ADD CONSTRAINT "WholesalePricingTier_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "WholesalePricingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SrDiscountPolicy" ADD CONSTRAINT "SrDiscountPolicy_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscountApprovalLog" ADD CONSTRAINT "OrderDiscountApprovalLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscountApprovalLog" ADD CONSTRAINT "OrderDiscountApprovalLog_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscountApprovalLog" ADD CONSTRAINT "OrderDiscountApprovalLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
