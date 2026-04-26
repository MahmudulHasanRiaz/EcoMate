/*
  Warnings:

  - Added the required table `CheckPassingLog`.
*/
-- CreateTable
CREATE TABLE IF NOT EXISTS "CheckPassingLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "previousStatus" "CheckStatus",
    "newStatus" "CheckStatus" NOT NULL,
    "note" TEXT,
    "userName" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckPassingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CheckPassingLog_source_sourceId_idx" ON "CheckPassingLog"("source", "sourceId");
CREATE INDEX IF NOT EXISTS "CheckPassingLog_createdAt_idx" ON "CheckPassingLog"("createdAt");
