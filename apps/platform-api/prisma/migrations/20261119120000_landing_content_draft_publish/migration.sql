-- Draft / publish / revisions / optimistic locking for LandingContent
-- (CMS batch 2, item 17). Adds status + version to LandingContent,
-- backfills existing rows as published v1 (every row that exists today
-- was live the moment it was saved — edits published immediately), and
-- adds the append-only LandingContentRevision table. No enum involved.

-- AlterTable
ALTER TABLE "LandingContent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "LandingContent" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Backfill: existing rows were all live, so all of them are published.
UPDATE "LandingContent" SET "status" = 'published', "version" = 1;

-- CreateIndex (the public read filters status + isActive)
CREATE INDEX "LandingContent_status_isActive_idx" ON "LandingContent"("status", "isActive");

-- CreateTable
CREATE TABLE "LandingContentRevision" (
    "id" TEXT NOT NULL,
    "landingContentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingContentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LandingContentRevision_landingContentId_version_idx" ON "LandingContentRevision"("landingContentId", "version");

-- CreateIndex
CREATE INDEX "LandingContentRevision_landingContentId_createdAt_idx" ON "LandingContentRevision"("landingContentId", "createdAt");

-- AddForeignKey
ALTER TABLE "LandingContentRevision" ADD CONSTRAINT "LandingContentRevision_landingContentId_fkey" FOREIGN KEY ("landingContentId") REFERENCES "LandingContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
