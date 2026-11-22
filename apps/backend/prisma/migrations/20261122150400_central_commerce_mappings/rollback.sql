-- Rollback for 20261122150400_central_commerce_mappings.
-- Drops the tables created by this migration (children first).
DROP TABLE IF EXISTS "StoreOrderStatusMap" CASCADE;
DROP TABLE IF EXISTS "StoreOrderMapping" CASCADE;
DROP TABLE IF EXISTS "StoreMediaMapping" CASCADE;
DROP TABLE IF EXISTS "StoreSkuMapping" CASCADE;
DROP TABLE IF EXISTS "StoreCategoryMapping" CASCADE;
DROP TABLE IF EXISTS "StoreVariantMapping" CASCADE;
DROP TABLE IF EXISTS "StoreProductMapping" CASCADE;
