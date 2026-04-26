-- CreateEnum
CREATE TYPE "MarketingPlatform" AS ENUM ('Meta', 'TikTok', 'Google');

-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "platform" "MarketingPlatform",
ADD COLUMN     "targetCpaBdt" DOUBLE PRECISION,
ADD COLUMN     "targetCpaUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "MarketingSpend" ADD COLUMN     "amountBdt" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "amountUsd" DOUBLE PRECISION,
ADD COLUMN     "fxRate" DOUBLE PRECISION;

-- Backfill
UPDATE "MarketingSpend" SET "amountBdt" = "amount";
UPDATE "MarketingCampaign" SET "platform" = 'Meta' WHERE "platform" IS NULL;
