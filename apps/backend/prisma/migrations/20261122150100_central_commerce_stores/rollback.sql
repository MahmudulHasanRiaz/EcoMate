-- Rollback for 20261122150100_central_commerce_stores.
-- Drops the tables created by this migration (children first).
DROP TABLE IF EXISTS "StoreHealthCheck" CASCADE;
DROP TABLE IF EXISTS "StoreCredential" CASCADE;
DROP TABLE IF EXISTS "Store" CASCADE;
