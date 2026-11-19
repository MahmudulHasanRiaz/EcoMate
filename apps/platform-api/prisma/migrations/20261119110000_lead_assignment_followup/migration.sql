-- Lead assignment + follow-up + notes (landing CMS Batch 2, item 12).
-- DDL only, all three columns nullable — existing leads are untouched.
-- assignedToId FKs to PlatformUser with ON DELETE SET NULL so a lead
-- survives its assignee being deleted. Indexes per the indexing rule
-- (assignee worklists + the overdue query both filter on these).
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "assignedToId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "followUpAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "internalNotes" TEXT;

-- CreateIndex
CREATE INDEX "Lead_assignedToId_idx" ON "Lead"("assignedToId");

-- CreateIndex
CREATE INDEX "Lead_followUpAt_idx" ON "Lead"("followUpAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
