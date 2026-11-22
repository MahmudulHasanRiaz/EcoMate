-- Rollback for 20261122110100_client_reviews_media_backfill (DML only).
-- Resets the new media columns to their defaults on both tables.
-- Documented caveat: this also discards any new-media edits made
-- between the backfill and the rollback. That is accepted because (a)
-- rollback only happens when the whole deploy is being reverted, and
-- (b) the legacy columns still hold the truth — re-running the
-- backfill after a rollback reproduces the backfilled state exactly.
-- The legacy columns are NEVER touched by this rollback.

UPDATE "BlogPost" SET
  "thumbnailUrl" = NULL,
  "thumbnailType" = 'image',
  "thumbnailVideoUrl" = NULL,
  "thumbnailAutoplay" = false,
  "videos" = '[]'::jsonb,
  "galleryImages" = '[]'::jsonb;
UPDATE "CaseStudy" SET
  "thumbnailUrl" = NULL,
  "thumbnailType" = 'image',
  "thumbnailVideoUrl" = NULL,
  "thumbnailAutoplay" = false,
  "videos" = '[]'::jsonb,
  "galleryImages" = '[]'::jsonb;
