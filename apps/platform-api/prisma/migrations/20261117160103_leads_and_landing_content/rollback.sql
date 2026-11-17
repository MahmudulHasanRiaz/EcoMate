-- Rollback for 20261117160103_leads_and_landing_content.
--
-- WARNING: drops the Lead and LandingContent tables — all captured leads
-- and all console-managed landing content are lost. Export them first if
-- they matter (GET /leads and GET /landing-content from the console API).
-- The landing falls back to its built-in content when LandingContent is
-- gone, so the public site keeps working after this rollback.

-- DropTable
DROP TABLE "LandingContent";

-- DropTable
DROP TABLE "Lead";

-- DropEnum
DROP TYPE "LeadStatus";

-- DropEnum
DROP TYPE "LeadContactType";

-- RestoreDefault: the pre-migration DB default on
-- PlatformRefreshToken.familyId (added by 20261116223521 for the backfill;
-- the schema declares no @default and the app always sets familyId, so
-- restoring it is only for exact pre-migration fidelity).
ALTER TABLE "PlatformRefreshToken" ALTER COLUMN "familyId" SET DEFAULT gen_random_uuid()::text;
