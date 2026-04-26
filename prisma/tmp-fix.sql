-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "ipHash" TEXT;

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

    CONSTRAINT "WooCheckoutLead_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "WooCheckoutLead_fingerprint_key" ON "WooCheckoutLead"("fingerprint");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_integrationId_idx" ON "WooCheckoutLead"("integrationId");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_businessId_idx" ON "WooCheckoutLead"("businessId");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_status_idx" ON "WooCheckoutLead"("status");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_phoneNormalized_idx" ON "WooCheckoutLead"("phoneNormalized");

-- CreateIndex
CREATE INDEX "WooCheckoutLead_lastSeenAt_idx" ON "WooCheckoutLead"("lastSeenAt");

-- CreateIndex
CREATE INDEX "OrderRestriction_targetHash_targetType_idx" ON "OrderRestriction"("targetHash", "targetType");

-- CreateIndex
CREATE INDEX "OrderRestriction_scope_idx" ON "OrderRestriction"("scope");

-- CreateIndex
CREATE INDEX "OrderRestriction_integrationId_idx" ON "OrderRestriction"("integrationId");

-- CreateIndex
CREATE INDEX "OrderRestriction_expiresAt_idx" ON "OrderRestriction"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WooCommerceIntegration_apiKey_key" ON "WooCommerceIntegration"("apiKey");

-- AddForeignKey
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WooCheckoutLead" ADD CONSTRAINT "WooCheckoutLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRestriction" ADD CONSTRAINT "OrderRestriction_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
