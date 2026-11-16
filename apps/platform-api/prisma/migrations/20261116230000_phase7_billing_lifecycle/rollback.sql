-- Rollback for 20261116230000_phase7_billing_lifecycle.
-- Drops the Phase 7 billing lifecycle additions. Pending plan changes and
-- reminder history are lost on rollback (both are re-derivable: the renewal
-- job re-sends reminders it has no record of).

DROP INDEX IF EXISTS "PaymentProof_methodId_transactionId_active_key";
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_pendingPlanVersionId_fkey";
ALTER TABLE "InvoiceReminder" DROP CONSTRAINT IF EXISTS "InvoiceReminder_tenantId_fkey";
DROP TABLE IF EXISTS "InvoiceReminder";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "pendingPlanVersionId";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "pendingPlanEffectiveAt";
