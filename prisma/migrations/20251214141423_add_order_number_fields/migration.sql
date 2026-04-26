-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderDay" TEXT,
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "orderSerial" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_orderDay_orderSerial_idx" ON "Order"("orderDay", "orderSerial");