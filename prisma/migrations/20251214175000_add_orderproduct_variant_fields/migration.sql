-- Add SKU, variant, site discount, and component breakdown to order line items
ALTER TABLE "OrderProduct"
    ADD COLUMN IF NOT EXISTS "sku" TEXT,
    ADD COLUMN IF NOT EXISTS "variantId" TEXT,
    ADD COLUMN IF NOT EXISTS "siteDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "componentBreakdown" JSONB;

-- Helpful index for lookups by SKU (nullable)
CREATE INDEX IF NOT EXISTS "OrderProduct_sku_idx" ON "OrderProduct" ("sku");
