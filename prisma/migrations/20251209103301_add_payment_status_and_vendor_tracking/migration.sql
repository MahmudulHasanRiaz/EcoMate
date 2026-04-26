-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('Unpaid', 'Partial', 'Paid');

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "cuttingDamagedQty" INTEGER DEFAULT 0,
ADD COLUMN     "cuttingReceivedQty" INTEGER DEFAULT 0,
ADD COLUMN     "cuttingVendorId" TEXT,
ADD COLUMN     "fabricDamagedQty" INTEGER DEFAULT 0,
ADD COLUMN     "fabricSentQty" INTEGER DEFAULT 0,
ADD COLUMN     "finalDamagedQty" INTEGER DEFAULT 0,
ADD COLUMN     "finalReceivedQty" INTEGER DEFAULT 0,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'Unpaid',
ADD COLUMN     "printingDamagedQty" INTEGER DEFAULT 0,
ADD COLUMN     "printingReceivedQty" INTEGER DEFAULT 0,
ADD COLUMN     "printingSentQty" INTEGER DEFAULT 0,
ADD COLUMN     "printingVendorId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_printingVendorId_fkey" FOREIGN KEY ("printingVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cuttingVendorId_fkey" FOREIGN KEY ("cuttingVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
