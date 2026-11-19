-- Rollback for 20261119120000_landing_content_draft_publish.
-- Drops the revision table (all publish snapshots are lost) and the
-- status/version columns. Draft state is lost with them: rows return
-- to the old model where every edit is live immediately (the public
-- read's published-only filter goes with the columns, so no row stays
-- hidden after rollback).
DROP TABLE IF EXISTS "LandingContentRevision";
DROP INDEX IF EXISTS "LandingContent_status_isActive_idx";
ALTER TABLE "LandingContent" DROP COLUMN IF EXISTS "status";
ALTER TABLE "LandingContent" DROP COLUMN IF EXISTS "version";
