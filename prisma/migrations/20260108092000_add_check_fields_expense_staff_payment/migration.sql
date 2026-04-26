/*
  Warnings:

  - Added check tracking fields to StaffPayment and Expense.
*/
-- AlterTable
ALTER TABLE "StaffPayment" ADD COLUMN     "check" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StaffPayment" ADD COLUMN     "checkDate" TIMESTAMP(3);
ALTER TABLE "StaffPayment" ADD COLUMN     "checkStatus" "CheckStatus";

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "check" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Expense" ADD COLUMN     "checkDate" TIMESTAMP(3);
ALTER TABLE "Expense" ADD COLUMN     "checkStatus" "CheckStatus";
