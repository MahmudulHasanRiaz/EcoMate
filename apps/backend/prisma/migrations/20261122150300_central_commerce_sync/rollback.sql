-- Rollback for 20261122150300_central_commerce_sync.
-- Drops the tables created by this migration (children first).
DROP TABLE IF EXISTS "StoreWebhookDelivery" CASCADE;
DROP TABLE IF EXISTS "StoreSyncIssue" CASCADE;
DROP TABLE IF EXISTS "SyncAttempt" CASCADE;
DROP TABLE IF EXISTS "SyncRunItem" CASCADE;
DROP TABLE IF EXISTS "SyncRun" CASCADE;
