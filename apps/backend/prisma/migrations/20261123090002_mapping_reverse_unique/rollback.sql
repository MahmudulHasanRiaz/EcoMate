-- Rollback for 20261123090002_mapping_reverse_unique.
DROP INDEX IF EXISTS "StoreVariantMapping_storeId_externalId_key";
DROP INDEX IF EXISTS "StoreProductMapping_storeId_externalId_key";
