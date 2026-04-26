-- AlterTable
ALTER TABLE "ProductionStep" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'Unpaid';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "creditBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ProductionStep_createdAt_idx" ON "ProductionStep"("createdAt");

