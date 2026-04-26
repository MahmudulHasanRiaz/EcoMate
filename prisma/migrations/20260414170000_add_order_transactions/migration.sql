-- CreateTable
CREATE TABLE "OrderTransaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentType" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "accountId" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderTransaction_orderId_idx" ON "OrderTransaction"("orderId");

-- CreateIndex
CREATE INDEX "OrderTransaction_status_idx" ON "OrderTransaction"("status");

-- CreateIndex
CREATE INDEX "OrderTransaction_businessId_idx" ON "OrderTransaction"("businessId");

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransaction" ADD CONSTRAINT "OrderTransaction_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
