-- CreateTable
CREATE TABLE "CashDrawer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawerTransfer" (
    "id" TEXT NOT NULL,
    "fromDrawerId" TEXT NOT NULL,
    "toDrawerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "postingGroup" TEXT NOT NULL,
    "businessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CashDrawerTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashDrawer_accountId_key" ON "CashDrawer"("accountId");

-- CreateIndex
CREATE INDEX "CashDrawer_businessId_idx" ON "CashDrawer"("businessId");

-- CreateIndex
CREATE INDEX "CashDrawerTransfer_businessId_idx" ON "CashDrawerTransfer"("businessId");

-- CreateIndex
CREATE INDEX "CashDrawerTransfer_fromDrawerId_idx" ON "CashDrawerTransfer"("fromDrawerId");

-- CreateIndex
CREATE INDEX "CashDrawerTransfer_toDrawerId_idx" ON "CashDrawerTransfer"("toDrawerId");

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerTransfer" ADD CONSTRAINT "CashDrawerTransfer_fromDrawerId_fkey" FOREIGN KEY ("fromDrawerId") REFERENCES "CashDrawer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerTransfer" ADD CONSTRAINT "CashDrawerTransfer_toDrawerId_fkey" FOREIGN KEY ("toDrawerId") REFERENCES "CashDrawer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerTransfer" ADD CONSTRAINT "CashDrawerTransfer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerTransfer" ADD CONSTRAINT "CashDrawerTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
