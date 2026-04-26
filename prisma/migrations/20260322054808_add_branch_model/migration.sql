-- AlterTable
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Expense_branchId_date_idx" ON "Expense"("branchId", "date");

-- AddForeignKey (skip if exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_branchId_fkey') THEN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
