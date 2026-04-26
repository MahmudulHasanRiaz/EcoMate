-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMP(3);

-- AlterEnum
-- This is wrapped in a try-catch equivalent for Postgres to avoid failure if 'Call' already exists
DO $$ 
BEGIN
  BEGIN
    ALTER TYPE "OrderPlatform" ADD VALUE 'Call';
  EXCEPTION
    WHEN duplicate_object THEN null;
  END;
END $$;
