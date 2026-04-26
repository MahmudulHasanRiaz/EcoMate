/*
  Warnings:

  - A unique constraint covering the columns `[staffPaymentId]` on the table `Expense` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "staffPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_staffPaymentId_key" ON "Expense"("staffPaymentId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_staffPaymentId_fkey" FOREIGN KEY ("staffPaymentId") REFERENCES "StaffPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
