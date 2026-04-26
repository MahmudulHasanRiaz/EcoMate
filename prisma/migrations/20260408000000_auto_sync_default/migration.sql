ALTER TABLE "WooCommerceIntegration"
  ADD COLUMN IF NOT EXISTS "autoSyncEnabled" BOOLEAN DEFAULT true;

ALTER TABLE "WooCommerceIntegration"
  ALTER COLUMN "autoSyncEnabled" SET DEFAULT true;

-- Backfill existing integrations to ON (if currently untouched/NULL)
UPDATE "WooCommerceIntegration"
SET "autoSyncEnabled" = true
WHERE "autoSyncEnabled" IS NULL;
