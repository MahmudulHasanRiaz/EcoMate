-- Rollback for 20261118155700_pricing_engine_backfill.
-- Resets the backfilled data only (the DDL rollback drops the columns
-- anyway). NOTE: this also resets any pricing document an operator wrote
-- between migrate and rollback — a rollback is a deliberate destructive
-- step, not a routine operation.
UPDATE "PlanVersion" SET "pricing" = '{}'::jsonb;
UPDATE "Invoice" SET "kind" = 'MANUAL'
WHERE "kind" = 'SUBSCRIPTION' AND "subscriptionId" IS NOT NULL;
