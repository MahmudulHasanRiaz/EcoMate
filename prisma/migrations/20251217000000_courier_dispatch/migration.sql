-- AlterTable
ALTER TABLE "Order"
ADD COLUMN     "courierConsignmentId" TEXT,
ADD COLUMN     "courierDispatchedAt" TIMESTAMP(3),
ADD COLUMN     "courierMeta" JSONB,
ADD COLUMN     "courierService" "CourierService",
ADD COLUMN     "courierStatus" TEXT,
ADD COLUMN     "courierTrackingCode" TEXT;

-- CreateTable
CREATE TABLE "CourierDispatchLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT,
    "courierName" "CourierService" NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierDispatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourierDispatchLog_orderId_idx" ON "CourierDispatchLog"("orderId");
CREATE INDEX "CourierDispatchLog_businessId_idx" ON "CourierDispatchLog"("businessId");

-- AddForeignKey
ALTER TABLE "CourierDispatchLog" ADD CONSTRAINT "CourierDispatchLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
