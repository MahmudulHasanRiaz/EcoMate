-- Deploy-readiness fixes for wholesale/SR migrations after 33098c6.
-- This migration is intentionally forward-only and non-destructive.

CREATE OR REPLACE FUNCTION "_migration_jsonb_text_array"(value JSONB)
RETURNS TEXT[]
LANGUAGE SQL
IMMUTABLE
AS $fn$
  SELECT COALESCE(array_agg(item), ARRAY[]::TEXT[])
  FROM jsonb_array_elements_text(value) AS item;
$fn$;

-- Phase 3 schema alignment: sourcePlatforms must match Prisma String[] (PostgreSQL TEXT[]).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'WholesaleQualificationRule'
      AND column_name = 'sourcePlatforms'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE "WholesaleQualificationRule"
      ALTER COLUMN "sourcePlatforms" TYPE TEXT[]
      USING CASE
        WHEN "sourcePlatforms" IS NULL THEN ARRAY[]::TEXT[]
        WHEN jsonb_typeof("sourcePlatforms") = 'array' THEN "_migration_jsonb_text_array"("sourcePlatforms")
        ELSE ARRAY[]::TEXT[]
      END;
  END IF;
END $$;

DROP FUNCTION IF EXISTS "_migration_jsonb_text_array"(JSONB);

-- Phase 3 schema alignment: indexes declared in Prisma schema.
CREATE UNIQUE INDEX IF NOT EXISTS "WholesaleQualificationRule_name_key"
  ON "WholesaleQualificationRule"("name");

CREATE INDEX IF NOT EXISTS "Order_wholesaleApprovalStatus_idx"
  ON "Order"("wholesaleApprovalStatus");

CREATE INDEX IF NOT EXISTS "Order_wholesaleDetectedByRuleId_idx"
  ON "Order"("wholesaleDetectedByRuleId");

-- Phase 7 schema alignment: enum values and optional campaign/discount fields.
ALTER TYPE "SrIncentiveType" ADD VALUE IF NOT EXISTS 'DiscountUnlock';
ALTER TYPE "SrIncentiveType" ADD VALUE IF NOT EXISTS 'CampaignOffer';

ALTER TABLE "SrIncentivePolicy"
  ADD COLUMN IF NOT EXISTS "discountCapOverride" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "campaignCode" TEXT,
  ADD COLUMN IF NOT EXISTS "campaignStartDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "campaignEndDate" TIMESTAMP(3);

-- Existing relation had ON DELETE SET NULL while customerPhone is required.
-- Use NO ACTION to match the required field and remove Prisma validation warnings.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_customerPhone_fkey";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_customerPhone_fkey"
  FOREIGN KEY ("customerPhone") REFERENCES "Customer"("phone")
  ON DELETE NO ACTION ON UPDATE CASCADE;
