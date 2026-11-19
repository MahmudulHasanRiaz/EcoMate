-- Rollback for 20261119150000_ad_tracking_dispatch.
-- Drops the AdDispatch queue (pending/failed dispatch state is lost;
-- sent history with it) and the Lead capture columns (fbp/fbc/eventId/
-- ttclid/tiktokEventId values are lost). Leads themselves are untouched.
-- The ad_tracking PlatformSetting row is left in place (harmless: the
-- settings read falls back to defaults when no code reads it).
DROP TABLE IF EXISTS "AdDispatch";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "fbp";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "fbc";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "eventId";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "ttclid";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "tiktokEventId";
