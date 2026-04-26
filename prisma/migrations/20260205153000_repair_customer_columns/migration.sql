-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "ip" TEXT;

-- Safely ensure updatedAt also exists (just in case)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
