-- Rollback for 20261123090003_mapping_origin.
ALTER TABLE "StoreVariantMapping" DROP COLUMN IF EXISTS "origin";
ALTER TABLE "StoreProductMapping" DROP COLUMN IF EXISTS "origin";
DROP TYPE IF EXISTS "MappingOrigin";
