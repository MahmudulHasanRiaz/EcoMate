-- CreateEnum
CREATE TYPE "CourierChargesSource" AS ENUM ('Config', 'Invoice');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "courierChargesSource" "CourierChargesSource" NOT NULL DEFAULT 'Config';

-- CreateTable
CREATE TABLE "CourierInvoice" (
    "id" TEXT NOT NULL,
    "courierService" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "businessId" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "mismatchRows" INTEGER NOT NULL DEFAULT 0,
    "totalCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalBilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourierInvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "consignmentId" TEXT,
    "collectableAmount" DOUBLE PRECISION,
    "collectedAmount" DOUBLE PRECISION,
    "codFee" DOUBLE PRECISION,
    "deliveryFee" DOUBLE PRECISION,
    "additionalCharge" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "totalFee" DOUBLE PRECISION,
    "billingAmount" DOUBLE PRECISION,
    "deliveryStatus" TEXT,
    "paymentStatus" TEXT,
    "payoutMethod" TEXT,
    "createdDate" TIMESTAMP(3),
    "deliveredDate" TIMESTAMP(3),
    "invoicedDate" TIMESTAMP(3),
    "mismatchReason" TEXT,
    "dueMismatchAmount" DOUBLE PRECISION,
    "billingMismatchAmount" DOUBLE PRECISION,
    "raw" JSONB,

    CONSTRAINT "CourierInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourierInvoice_invoiceNumber_courierService_key" ON "CourierInvoice"("invoiceNumber", "courierService");

-- CreateIndex
CREATE INDEX "CourierInvoice_courierService_idx" ON "CourierInvoice"("courierService");

-- CreateIndex
CREATE INDEX "CourierInvoice_businessId_idx" ON "CourierInvoice"("businessId");

-- CreateIndex
CREATE INDEX "CourierInvoiceItem_invoiceId_idx" ON "CourierInvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "CourierInvoiceItem_orderNumber_idx" ON "CourierInvoiceItem"("orderNumber");

-- CreateIndex
CREATE INDEX "CourierInvoiceItem_consignmentId_idx" ON "CourierInvoiceItem"("consignmentId");

-- AddForeignKey
ALTER TABLE "CourierInvoiceItem" ADD CONSTRAINT "CourierInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CourierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
