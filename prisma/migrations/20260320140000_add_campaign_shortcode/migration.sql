-- AlterTable
ALTER TABLE "MarketingCampaign" ADD COLUMN "shortCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_shortCode_key" ON "MarketingCampaign"("shortCode");
