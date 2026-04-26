-- Add tracked products for marketing campaigns to enforce product-scoped ROI tracking.
ALTER TABLE "MarketingCampaign"
ADD COLUMN "trackedProductIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

