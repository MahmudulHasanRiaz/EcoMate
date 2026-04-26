-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "actualCodAmount" DOUBLE PRECISION,
ADD COLUMN     "chargesLastUpdated" TIMESTAMP(3),
ADD COLUMN     "chargesUpdatedBy" TEXT,
ADD COLUMN     "courierCodCharge" DOUBLE PRECISION,
ADD COLUMN     "courierDeliveryCharge" DOUBLE PRECISION,
ADD COLUMN     "courierNetPayable" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CourierPayment" (
    "id" TEXT NOT NULL,
    "courierService" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierPayment_courierService_businessId_paymentDate_idx" ON "CourierPayment"("courierService", "businessId", "paymentDate");

-- CreateIndex
CREATE INDEX "Order_courierService_status_courierDispatchedAt_idx" ON "Order"("courierService", "status", "courierDispatchedAt");

-- AddForeignKey
ALTER TABLE "CourierPayment" ADD CONSTRAINT "CourierPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

