-- Rollback for 20261122110000_client_reviews_media (DDL only).
-- Drops the ClientReview table, the six media columns on BlogPost +
-- CaseStudy, and the raw-SQL partial index. The legacy media columns
-- (featuredImageUrl / videoUrl / galleryUrls) are NEVER touched —
-- they still hold the truth, so a code rollback keeps serving.
-- WARNING: any ClientReview rows (incl. migrated testimonials) are
-- lost by this rollback; re-run the testimonial migration script
-- after re-applying migration A to restore them.

DROP INDEX IF EXISTS "ClientReview_published_sort_idx";
ALTER TABLE "ClientReview" DROP CONSTRAINT IF EXISTS "ClientReview_caseStudyId_fkey";
DROP TABLE IF EXISTS "ClientReview";
ALTER TABLE "BlogPost"
  DROP COLUMN IF EXISTS "galleryImages",
  DROP COLUMN IF EXISTS "thumbnailAutoplay",
  DROP COLUMN IF EXISTS "thumbnailType",
  DROP COLUMN IF EXISTS "thumbnailUrl",
  DROP COLUMN IF EXISTS "thumbnailVideoUrl",
  DROP COLUMN IF EXISTS "videos";
ALTER TABLE "CaseStudy"
  DROP COLUMN IF EXISTS "galleryImages",
  DROP COLUMN IF EXISTS "thumbnailAutoplay",
  DROP COLUMN IF EXISTS "thumbnailType",
  DROP COLUMN IF EXISTS "thumbnailUrl",
  DROP COLUMN IF EXISTS "thumbnailVideoUrl",
  DROP COLUMN IF EXISTS "videos";
