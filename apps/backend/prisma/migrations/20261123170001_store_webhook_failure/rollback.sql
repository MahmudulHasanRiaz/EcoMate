-- Rollback for 20261123170001_store_webhook_failure.
DROP TABLE IF EXISTS "StoreWebhookFailure" CASCADE;
DROP TYPE IF EXISTS "WebhookFailureStatus";
