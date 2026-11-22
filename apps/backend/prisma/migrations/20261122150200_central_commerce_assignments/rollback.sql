-- Rollback for 20261122150200_central_commerce_assignments.
-- Drops the tables created by this migration (children first).
DROP TABLE IF EXISTS "ProductStoreFieldState" CASCADE;
DROP TABLE IF EXISTS "StoreAvailabilityRule" CASCADE;
DROP TABLE IF EXISTS "ProductStoreAssignment" CASCADE;
