-- AlterEnum
ALTER TYPE "CheckPassingSource" ADD VALUE 'CutoffSettlement';

-- CreateTable
CREATE TABLE "CutoffSettlement" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "check" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "checkDate" TIMESTAMP(3),
    "checkStatus" "CheckStatus",
    "checkNo" TEXT,
    "paidFromAccountId" TEXT,
    "paymentMethod" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutoffSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CutoffSettlement_revisionId_idx" ON "CutoffSettlement"("revisionId");

-- CreateIndex
CREATE INDEX "CutoffSettlement_entityType_entityId_idx" ON "CutoffSettlement"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CutoffSettlement_checkDate_checkStatus_idx" ON "CutoffSettlement"("checkDate", "checkStatus");

-- AddForeignKey
ALTER TABLE "CutoffSettlement" ADD CONSTRAINT "CutoffSettlement_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CutoffRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CutoffSettlement" ADD CONSTRAINT "CutoffSettlement_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
