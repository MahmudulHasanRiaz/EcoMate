-- CreateEnum
CREATE TYPE "CheckPassingSource" AS ENUM ('Purchase', 'Expense', 'Staff');

-- CreateEnum
CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('Submitted', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('Queued', 'Processing', 'Completed', 'Failed');

-- CreateEnum
CREATE TYPE "ExportJobType" AS ENUM ('OrdersCsv');

-- CreateEnum
CREATE TYPE "ProductionCuttingType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('Low', 'Medium', 'High', 'Urgent');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ToDo', 'InProgress', 'InReview', 'Done', 'Cancelled');

-- CreateEnum
CREATE TYPE "WebhookFailureStatus" AS ENUM ('Open', 'Resolved', 'Ignored');

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PartialReceived';

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'CuttingMan';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "ip" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "approvalStatus" "ExpenseApprovalStatus" NOT NULL DEFAULT 'Approved',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "checkNo" TEXT,
ADD COLUMN     "paidById" TEXT,
ADD COLUMN     "paidByName" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectedByName" TEXT,
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "submittedByName" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "ipHash" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "image" TEXT;

-- AlterTable
ALTER TABLE "ProductionStep" ADD COLUMN     "assignedStaffId" TEXT,
ADD COLUMN     "cuttingType" "ProductionCuttingType",
ADD COLUMN     "paymentAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ratePerQty" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "pindaBreakdown" JSONB,
ADD COLUMN     "pindaCount" INTEGER DEFAULT 1,
ADD COLUMN     "receivedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchasePayment" ADD COLUMN     "checkNo" TEXT;

-- AlterTable
ALTER TABLE "StaffPayment" ADD COLUMN     "checkNo" TEXT;

-- AlterTable
ALTER TABLE "WebhookFailure" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "occurrences" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "resolvedNote" TEXT,
ADD COLUMN     "status" "WebhookFailureStatus" NOT NULL DEFAULT 'Open';

-- AlterTable
ALTER TABLE "WooCommerceIntegration" ADD COLUMN     "apiKey" TEXT,
ADD COLUMN     "debounceMs" INTEGER DEFAULT 1200,
ADD COLUMN     "dedupeMinutes" INTEGER DEFAULT 10,
ADD COLUMN     "incompleteEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restrictionDurationType" TEXT NOT NULL DEFAULT 'days',
ADD COLUMN     "restrictionDurationValue" INTEGER DEFAULT 1,
ADD COLUMN     "restrictionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restrictionMessage" TEXT,
ADD COLUMN     "restrictionScope" TEXT NOT NULL DEFAULT 'site',
ADD COLUMN     "restrictionSupportPhone" TEXT,
ADD COLUMN     "retrySeconds" INTEGER DEFAULT 15,
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "supportPhone" TEXT;

-- CreateTable
CREATE TABLE "CheckPassingItem" (
    "id" TEXT NOT NULL,
    "source" "CheckPassingSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "passingDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "CheckStatus" NOT NULL,
    "checkNo" TEXT,
    "referenceId" TEXT,
    "referenceLabel" TEXT,
    "referenceUrl" TEXT,
    "payee" TEXT,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckPassingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "type" "ExportJobType" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'Queued',
    "createdById" TEXT,
    "businessId" TEXT,
    "params" JSONB,
    "filePath" TEXT,
    "fileName" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAttribution" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT,
    "marketerId" TEXT,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessId" TEXT,
    "marketerId" TEXT,
    "channel" TEXT,
    "objective" TEXT,
    "status" TEXT,
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSpend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "businessId" TEXT,
    "date" DATE NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRestriction" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "integrationId" TEXT,
    "businessId" TEXT,
    "message" TEXT,
    "supportPhone" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdByStaffId" TEXT,
    "sourceOrderId" TEXT,
    "sourceCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'ToDo',
    "priority" "TaskPriority" NOT NULL DEFAULT 'Medium',
    "dueDate" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "totalDuration" INTEGER DEFAULT 0,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WooCheckoutLead" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "uid" TEXT,
    "phoneNormalized" TEXT,
    "name" TEXT,
    "address" TEXT,
    "skuList" JSONB,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "fingerprint" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "convertedAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "convertedByStaffId" TEXT,

    CONSTRAINT "WooCheckoutLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckPassingItem_checkNo_idx" ON "CheckPassingItem"("checkNo");

-- CreateIndex
CREATE INDEX "CheckPassingItem_passingDate_source_id_idx" ON "CheckPassingItem"("passingDate", "source", "id");

-- CreateIndex
CREATE INDEX "CheckPassingItem_passingDate_status_idx" ON "CheckPassingItem"("passingDate", "status");

-- CreateIndex
CREATE INDEX "CheckPassingItem_payee_idx" ON "CheckPassingItem"("payee");

-- CreateIndex
CREATE INDEX "CheckPassingItem_referenceLabel_idx" ON "CheckPassingItem"("referenceLabel");

-- CreateIndex
CREATE INDEX "CheckPassingItem_source_sourceId_idx" ON "CheckPassingItem"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckPassingItem_source_sourceId_key" ON "CheckPassingItem"("source", "sourceId");

-- CreateIndex
CREATE INDEX "MarketingAttribution_businessId_idx" ON "MarketingAttribution"("businessId");

-- CreateIndex
CREATE INDEX "MarketingAttribution_marketerId_idx" ON "MarketingAttribution"("marketerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAttribution_campaignId_orderId_key" ON "MarketingAttribution"("campaignId", "orderId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_businessId_status_idx" ON "MarketingCampaign"("businessId", "status");

-- CreateIndex
CREATE INDEX "MarketingCampaign_marketerId_idx" ON "MarketingCampaign"("marketerId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_startDate_endDate_idx" ON "MarketingCampaign"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "MarketingSpend_businessId_date_idx" ON "MarketingSpend"("businessId", "date");

-- CreateIndex
CREATE INDEX "MarketingSpend_campaignId_date_idx" ON "MarketingSpend"("campaignId", "date");

-- CreateIndex
CREATE INDEX "OrderRestriction_expiresAt_idx" ON "OrderRestriction"("expiresAt");

-- CreateIndex
CREATE INDEX "OrderRestriction_integrationId_idx" ON "OrderRestriction"("integrationId");

-- CreateIndex
CREATE INDEX "OrderRestriction_scope_idx" ON "OrderRestriction"("scope");

-- CreateIndex
CREATE INDEX "OrderRestriction_targetHash_targetType_idx" ON "OrderRestriction"("targetHash", "targetType");

-- CreateIndex
CREATE INDEX "Task_assignedToId_idx" ON "Task"("assignedToId");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "TaskLog_taskId_idx" ON "TaskLog"("taskId");

-- CreateIndex
CREATE INDEX "TaskLog_userId_idx" ON "TaskLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WooCheckoutLead_fingerprint_key" ON "WooCheckoutLead"("fingerprint");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_businessId_idx" ON "WooCheckoutLead"("businessId");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_convertedAt_idx" ON "WooCheckoutLead"("convertedAt");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_convertedOrderId_idx" ON "WooCheckoutLead"("convertedOrderId");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_integrationId_idx" ON "WooCheckoutLead"("integrationId");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_lastSeenAt_idx" ON "WooCheckoutLead"("lastSeenAt");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_phoneNormalized_idx" ON "WooCheckoutLead"("phoneNormalized");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_status_idx" ON "WooCheckoutLead"("status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

-- CreateIndex
CREATE INDEX "Expense_checkNo_idx" ON "Expense"("checkNo");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_variantId_locationId_idx" ON "InventoryItem"("productId", "variantId", "locationId");

-- CreateIndex
CREATE INDEX "Order_customerPhone_gin_idx" ON "Order" USING GIN ("customerPhone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Order_orderNumber_gin_idx" ON "Order" USING GIN ("orderNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PurchasePayment_checkDate_idx" ON "PurchasePayment"("checkDate");

-- CreateIndex
CREATE INDEX "PurchasePayment_checkNo_idx" ON "PurchasePayment"("checkNo");

-- CreateIndex
CREATE INDEX "StaffPayment_checkNo_idx" ON "StaffPayment"("checkNo");

-- CreateIndex
CREATE INDEX "StaffPayment_staffId_createdAt_idx" ON "StaffPayment"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookFailure_status_createdAt_idx" ON "WebhookFailure"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WooCommerceIntegration_apiKey_key" ON "WooCommerceIntegration"("apiKey");

-- AddForeignKey
ALTER TABLE "MarketingAttribution" ADD CONSTRAINT "MarketingAttribution_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAttribution" ADD CONSTRAINT "MarketingAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAttribution" ADD CONSTRAINT "MarketingAttribution_marketerId_fkey" FOREIGN KEY ("marketerId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAttribution" ADD CONSTRAINT "MarketingAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_marketerId_fkey" FOREIGN KEY ("marketerId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionStep" ADD CONSTRAINT "ProductionStep_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

