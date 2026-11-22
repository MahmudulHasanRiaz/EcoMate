-- Shared-media backfill (landing-cms-media-design.md §4.2). DML ONLY.
--
-- Maps every existing legacy media value into the new model:
--   featuredImageUrl -> thumbnailUrl
--   galleryUrls      -> galleryImages (plain strings become {url} objects)
--   videoUrl         -> videos ([{url}])
--   thumbnailType is always 'image' — a legacy videoUrl was a *separate*
--   video, never a video *thumbnail*, so no row becomes a video thumbnail.
--
-- SAFETY (the single most important property of this migration):
-- - It only READS the legacy columns — featuredImageUrl, videoUrl and
--   galleryUrls are never written, so the old data stays byte-identical
--   and any backfill mistake is recoverable by re-running it.
-- - It never rewrites a URL (an http:// legacy URL stays http://).
-- - It never touches updatedAt (raw SQL does not trigger @updatedAt).
-- - IDEMPOTENCY GUARDS: each UPDATE only touches rows whose new field
--   is still at its default, so a re-run (or a partially-applied run)
--   never overwrites an operator edit made after the backfill.
-- - A featured image duplicated in galleryUrls stays duplicated (the
--   backfill does not second-guess the operator's data; the console
--   editor resolves it in one click).

-- BlogPost: thumbnail from the featured image.
UPDATE "BlogPost" SET "thumbnailUrl" = "featuredImageUrl"
  WHERE "thumbnailUrl" IS NULL AND "featuredImageUrl" IS NOT NULL;

-- BlogPost: gallery strings become {url} objects, order preserved.
-- NULL elements inside galleryUrls are dropped (a {url: null} entry
-- would be a malformed gallery row); an all-NULL array stays '[]'.
UPDATE "BlogPost" SET "galleryImages" = (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('url', u)), '[]'::jsonb)
    FROM unnest("galleryUrls") AS u WHERE u IS NOT NULL)
  WHERE "galleryImages" = '[]'::jsonb AND cardinality("galleryUrls") > 0;

-- BlogPost: the single video becomes a one-item video gallery.
UPDATE "BlogPost" SET "videos" = jsonb_build_array(jsonb_build_object('url', "videoUrl"))
  WHERE "videos" = '[]'::jsonb AND "videoUrl" IS NOT NULL;

-- CaseStudy: thumbnail from the featured image.
UPDATE "CaseStudy" SET "thumbnailUrl" = "featuredImageUrl"
  WHERE "thumbnailUrl" IS NULL AND "featuredImageUrl" IS NOT NULL;

-- CaseStudy: the single video becomes a one-item video gallery.
UPDATE "CaseStudy" SET "videos" = jsonb_build_array(jsonb_build_object('url', "videoUrl"))
  WHERE "videos" = '[]'::jsonb AND "videoUrl" IS NOT NULL;
