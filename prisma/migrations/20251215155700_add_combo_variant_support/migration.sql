-- AddComboVariantSupport Migration
-- This migration adds variantId support to ComboProductItem table
-- to enable tracking specific variants in combo products

-- Step 1: Add variantId column to ComboProductItem table
ALTER TABLE "ComboProductItem" ADD COLUMN "variantId" TEXT;

-- Step 2: Add foreign key constraint to ProductVariant
ALTER TABLE "ComboProductItem" 
ADD CONSTRAINT "ComboProductItem_variantId_fkey" 
FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") 
ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 3: Create index for better query performance
CREATE INDEX "ComboProductItem_variantId_idx" ON "ComboProductItem"("variantId");
