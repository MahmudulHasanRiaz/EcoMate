/*
  Warnings:

  - A unique constraint covering the columns `[postingGroup,accountId]` on the table `LedgerEntry` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CourierPaymentDirection" AS ENUM ('Received', 'Paid');

-- AlterTable
ALTER TABLE "CourierPayment" ADD COLUMN     "direction" "CourierPaymentDirection" NOT NULL DEFAULT 'Received',
ADD COLUMN     "receivedAccountId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "isPaid" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidFromAccountId" TEXT,
ADD COLUMN     "payableAccountId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "expenseAccountId" TEXT;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "entryNumber" TEXT,
ADD COLUMN     "postingGroup" TEXT,
ADD COLUMN     "snapshotId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "allocatedDiscount" DOUBLE PRECISION,
ADD COLUMN     "allocatedShipping" DOUBLE PRECISION,
ADD COLUMN     "allocatedSubtotal" DOUBLE PRECISION,
ADD COLUMN     "paidFromAccountId" TEXT,
ADD COLUMN     "shippingPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shippingPaidAccountId" TEXT,
ADD COLUMN     "shippingPaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchasePayment" ADD COLUMN     "paidFromAccountId" TEXT,
ADD COLUMN     "paymentMethod" TEXT;

-- AlterTable
ALTER TABLE "StaffPayment" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidFromAccountId" TEXT;

-- CreateTable
CREATE TABLE "LedgerEntrySequence" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntrySequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFinancialSnapshot" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT,
    "statusAtSnapshot" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cogs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "courierExpense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "courierReceivable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "courierPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnFeeRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cogsEstimated" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStockAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStockAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT,
    "eventType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntrySequence_dateKey_key" ON "LedgerEntrySequence"("dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFinancialSnapshot_orderId_key" ON "OrderFinancialSnapshot"("orderId");

-- CreateIndex
CREATE INDEX "OrderFinancialSnapshot_businessId_idx" ON "OrderFinancialSnapshot"("businessId");

-- CreateIndex
CREATE INDEX "OrderStockAllocation_orderId_idx" ON "OrderStockAllocation"("orderId");

-- CreateIndex
CREATE INDEX "OrderStockAllocation_inventoryItemId_idx" ON "OrderStockAllocation"("inventoryItemId");

-- CreateIndex
CREATE INDEX "OrderPaymentEvent_orderId_idx" ON "OrderPaymentEvent"("orderId");

-- CreateIndex
CREATE INDEX "OrderPaymentEvent_businessId_idx" ON "OrderPaymentEvent"("businessId");

-- CreateIndex
CREATE INDEX "Expense_businessId_date_idx" ON "Expense"("businessId", "date");

-- CreateIndex
CREATE INDEX "Expense_categoryId_date_idx" ON "Expense"("categoryId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_snapshotId_idx" ON "LedgerEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "LedgerEntry_postingGroup_idx" ON "LedgerEntry"("postingGroup");

-- CreateIndex
CREATE INDEX "LedgerEntry_entryNumber_idx" ON "LedgerEntry"("entryNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_postingGroup_accountId_key" ON "LedgerEntry"("postingGroup", "accountId");

-- CreateIndex
CREATE INDEX "Order_businessId_date_idx" ON "Order"("businessId", "date");

-- CreateIndex
CREATE INDEX "Order_businessId_status_date_idx" ON "Order"("businessId", "status", "date");

-- CreateIndex
CREATE INDEX "StaffPayment_date_idx" ON "StaffPayment"("date");

-- CreateIndex
CREATE INDEX "StaffPayment_staffId_date_idx" ON "StaffPayment"("staffId", "date");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippingPaidAccountId_fkey" FOREIGN KEY ("shippingPaidAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPayment" ADD CONSTRAINT "StaffPayment_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payableAccountId_fkey" FOREIGN KEY ("payableAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourierPayment" ADD CONSTRAINT "CourierPayment_receivedAccountId_fkey" FOREIGN KEY ("receivedAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinancialSnapshot" ADD CONSTRAINT "OrderFinancialSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFinancialSnapshot" ADD CONSTRAINT "OrderFinancialSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStockAllocation" ADD CONSTRAINT "OrderStockAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStockAllocation" ADD CONSTRAINT "OrderStockAllocation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentEvent" ADD CONSTRAINT "OrderPaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentEvent" ADD CONSTRAINT "OrderPaymentEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPaymentEvent" ADD CONSTRAINT "OrderPaymentEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
