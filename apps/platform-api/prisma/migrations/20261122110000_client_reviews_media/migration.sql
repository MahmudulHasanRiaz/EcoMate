-- Landing CMS shared media model + ClientReview (Boss 2026-11-22).
-- DDL ONLY, purely additive — no data is touched (the backfill is the
-- next migration, 20261122110100). No enums are added.
--
-- - Six shared-media columns on BlogPost + CaseStudy (Portfolio-V3
--   migration 0010 port; see landing-cms-media-design.md §2). All
--   nullable or defaulted — no table rewrite, no lock risk beyond a
--   brief ACCESS EXCLUSIVE on ALTER TABLE.
-- - New ClientReview table + indexes (§3, §8). The legacy
--   featuredImageUrl / videoUrl / galleryUrls columns STAY (deprecated,
--   dual-written) — they are dropped only by a later migration gated
--   on Boss's confirmation (§4.3).
-- - Raw-SQL partial index for the public published-only list (Prisma
--   has no partial-index support — BlogPost_slug_live_key precedent).

-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "galleryImages" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "thumbnailAutoplay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "thumbnailType" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "thumbnailVideoUrl" TEXT,
ADD COLUMN     "videos" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "CaseStudy" ADD COLUMN     "galleryImages" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "thumbnailAutoplay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "thumbnailType" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "thumbnailVideoUrl" TEXT,
ADD COLUMN     "videos" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ClientReview" (
    "id" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "companyName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "quoteEn" TEXT NOT NULL,
    "quoteBn" TEXT NOT NULL DEFAULT '',
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "rating" INTEGER,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL DEFAULT 'text',
    "videoProvider" TEXT NOT NULL DEFAULT 'youtube',
    "videoDuration" TEXT NOT NULL DEFAULT '',
    "caseStudyId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "thumbnailType" TEXT NOT NULL DEFAULT 'image',
    "thumbnailUrl" TEXT,
    "thumbnailVideoUrl" TEXT,
    "thumbnailAutoplay" BOOLEAN NOT NULL DEFAULT false,
    "videos" JSONB NOT NULL DEFAULT '[]',
    "galleryImages" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ClientReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientReview_sourceKey_key" ON "ClientReview"("sourceKey");

-- CreateIndex
CREATE INDEX "ClientReview_status_sortOrder_idx" ON "ClientReview"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "ClientReview_status_isFeatured_sortOrder_idx" ON "ClientReview"("status", "isFeatured", "sortOrder");

-- CreateIndex
CREATE INDEX "ClientReview_caseStudyId_idx" ON "ClientReview"("caseStudyId");

-- CreateIndex
CREATE INDEX "ClientReview_createdAt_idx" ON "ClientReview"("createdAt" DESC);

-- Partial index (raw SQL): the public list touches published rows
-- only — keep it small forever. Dropped in rollback.sql.
CREATE INDEX "ClientReview_published_sort_idx" ON "ClientReview"("sortOrder", "isFeatured") WHERE "status" = 'published';

-- AddForeignKey
ALTER TABLE "ClientReview" ADD CONSTRAINT "ClientReview_caseStudyId_fkey" FOREIGN KEY ("caseStudyId") REFERENCES "CaseStudy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
