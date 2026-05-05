-- CreateEnum
CREATE TYPE "WholesaleApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'EditedApproved');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "wholesaleApprovalStatus" "WholesaleApprovalStatus",
ADD COLUMN     "wholesaleDetectedAt" TIMESTAMP(3),
ADD COLUMN     "wholesaleDetectedByRuleId" TEXT,
ADD COLUMN     "wholesaleReviewNote" TEXT,
ADD COLUMN     "wholesaleReviewedAt" TIMESTAMP(3),
ADD COLUMN     "wholesaleReviewedById" TEXT;

-- CreateTable
CREATE TABLE "WholesaleQualificationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sourcePlatforms" JSONB NOT NULL,
    "minTotalQuantity" INTEGER,
    "minSubtotal" DOUBLE PRECISION,
    "minGrandTotal" DOUBLE PRECISION,
    "notes" TEXT,
    "businessId" TEXT,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleQualificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleOrderReviewLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "previousStatus" "WholesaleApprovalStatus",
    "nextStatus" "WholesaleApprovalStatus",
    "actorStaffId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleOrderReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WholesaleQualificationRule_priority_idx" ON "WholesaleQualificationRule"("priority");
CREATE INDEX "WholesaleQualificationRule_isActive_idx" ON "WholesaleQualificationRule"("isActive");
CREATE INDEX "WholesaleOrderReviewLog_orderId_idx" ON "WholesaleOrderReviewLog"("orderId");
CREATE INDEX "WholesaleOrderReviewLog_createdAt_idx" ON "WholesaleOrderReviewLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_wholesaleReviewedById_fkey" FOREIGN KEY ("wholesaleReviewedById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_wholesaleDetectedByRuleId_fkey" FOREIGN KEY ("wholesaleDetectedByRuleId") REFERENCES "WholesaleQualificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleQualificationRule" ADD CONSTRAINT "WholesaleQualificationRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrderReviewLog" ADD CONSTRAINT "WholesaleOrderReviewLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrderReviewLog" ADD CONSTRAINT "WholesaleOrderReviewLog_actorStaffId_fkey" FOREIGN KEY ("actorStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
