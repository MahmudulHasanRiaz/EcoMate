-- CreateTable
CREATE TABLE "Showroom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "cashDrawerId" TEXT NOT NULL,
    "defaultInvoiceNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Showroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowroomAccess" (
    "id" TEXT NOT NULL,
    "showroomId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowroomAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawerSession" (
    "id" TEXT NOT NULL,
    "cashDrawerId" TEXT NOT NULL,
    "openedById" TEXT,
    "closedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingBalance" DOUBLE PRECISION NOT NULL,
    "closingBalance" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDrawerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawerAdjustment" (
    "id" TEXT NOT NULL,
    "cashDrawerId" TEXT NOT NULL,
    "createdById" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "postingGroup" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashDrawerAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Showroom_name_key" ON "Showroom"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Showroom_locationId_key" ON "Showroom"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Showroom_cashDrawerId_key" ON "Showroom"("cashDrawerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowroomAccess_showroomId_staffId_key" ON "ShowroomAccess"("showroomId", "staffId");

-- CreateIndex
CREATE INDEX "CashDrawerSession_cashDrawerId_idx" ON "CashDrawerSession"("cashDrawerId");

-- CreateIndex
CREATE INDEX "CashDrawerAdjustment_cashDrawerId_idx" ON "CashDrawerAdjustment"("cashDrawerId");

-- AddForeignKey
ALTER TABLE "Showroom" ADD CONSTRAINT "Showroom_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Showroom" ADD CONSTRAINT "Showroom_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomAccess" ADD CONSTRAINT "ShowroomAccess_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Showroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomAccess" ADD CONSTRAINT "ShowroomAccess_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerSession" ADD CONSTRAINT "CashDrawerSession_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerAdjustment" ADD CONSTRAINT "CashDrawerAdjustment_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawerAdjustment" ADD CONSTRAINT "CashDrawerAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

