-- Rollback for 20261118085038_lead_consent_utm_convert.
-- Drops the FK + index + the five Batch 1 lead columns. Consent/UTM/
-- conversion data recorded after the migration is lost (the columns are
-- new — nothing pre-migration is affected).

ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_convertedTenantId_fkey";
DROP INDEX IF EXISTS "Lead_convertedTenantId_idx";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "convertedTenantId";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "utmCampaign";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "utmSource";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "consentText";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "consentGiven";
