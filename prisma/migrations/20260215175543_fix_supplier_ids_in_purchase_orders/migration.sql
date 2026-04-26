-- Fix Purchase Orders with incorrect supplierId
-- This migration corrects POs where supplierId contains a Vendor table ID instead of a Supplier table ID

-- Update PurchaseOrder records where supplierId matches a Vendor.id
-- and there exists a Supplier with the same name as that Vendor
UPDATE "PurchaseOrder" po
SET "supplierId" = s.id
FROM "Vendor" v
JOIN "Supplier" s ON s.name = v.name
WHERE po."supplierId" = v.id
  AND po."supplierId" IS NOT NULL;
