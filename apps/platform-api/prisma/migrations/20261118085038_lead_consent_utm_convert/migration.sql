-- Landing CMS Batch 1 (items 8 + C1): lead consent/UTM capture and the
-- convert-lead-to-tenant link.
--
-- consentGiven/consentText: the lead form already had a consent checkbox
-- but never sent or stored it; the API now persists the flag + the exact
-- label shown at submit time. utmSource/utmCampaign come from the form
-- page URL. convertedTenantId links a Won lead to the tenant it became
-- (FK to Tenant, SetNull on tenant purge so the lead record survives).
--
-- DDL only; no data migration. Existing rows get consentGiven=false and
-- NULL consent/UTM/tenant (unknown for pre-change leads).

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "consentGiven" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "consentText" TEXT;
ALTER TABLE "Lead" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "Lead" ADD COLUMN "convertedTenantId" TEXT;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedTenantId_fkey"
  FOREIGN KEY ("convertedTenantId") REFERENCES "Tenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Lead_convertedTenantId_idx" ON "Lead"("convertedTenantId");
