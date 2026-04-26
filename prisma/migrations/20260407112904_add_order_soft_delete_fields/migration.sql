-- AlterTable: Add soft-delete fields to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deleteNote" TEXT;

-- CreateIndex: Index on isDeleted for filtering performance
CREATE INDEX IF NOT EXISTS "Order_isDeleted_idx" ON "Order"("isDeleted");
