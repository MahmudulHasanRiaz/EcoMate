-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "Expense_isAdExpense_date_idx" ON "Expense"("isAdExpense", "date");

-- CreateIndex
CREATE INDEX "Order_customerName_idx" ON "Order" USING GIN ("customerName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PurchasePayment_vendorId_idx" ON "PurchasePayment"("vendorId");

-- CreateIndex
CREATE INDEX "PurchasePayment_paymentFor_idx" ON "PurchasePayment"("paymentFor");

-- CreateIndex
CREATE INDEX "StaffIncome_staffId_createdAt_idx" ON "StaffIncome"("staffId", "createdAt");
