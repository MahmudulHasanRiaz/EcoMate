-- Rollback for 20261117002049_phase7_billing_indexes: restore the
-- pre-audit indexes.
--
-- NOTE: recreating the full PaymentProof unique index fails if any
-- transaction id was resubmitted after a rejection while the partial-only
-- rule was in force (two rows, one REJECTED + one live, sharing a
-- (methodId, transactionId) pair). In that case delete or re-key the
-- REJECTED rows first, then re-run this script.

-- DropIndex
DROP INDEX "Subscription_status_trialEndsAt_idx";

-- DropIndex
DROP INDEX "Subscription_cancelAtPeriodEnd_currentPeriodEnd_idx";

-- DropIndex
DROP INDEX "Invoice_subscriptionId_status_periodStart_idx";

-- DropIndex
DROP INDEX "Invoice_createdAt_idx";

-- DropIndex
DROP INDEX "Tenant_status_graceEndsAt_idx";

-- RestoreIndex: Subscription(planVersionId, status) -> (planVersionId)
DROP INDEX "Subscription_planVersionId_status_idx";
CREATE INDEX "Subscription_planVersionId_idx" ON "Subscription"("planVersionId");

-- RestoreIndex: CreditNote(tenantId, appliedInvoiceId, createdAt) -> (tenantId)
DROP INDEX "CreditNote_tenantId_appliedInvoiceId_createdAt_idx";
CREATE INDEX "CreditNote_tenantId_idx" ON "CreditNote"("tenantId");

-- RestoreIndex: full unique on PaymentProof(methodId, transactionId)
CREATE UNIQUE INDEX "PaymentProof_methodId_transactionId_key" ON "PaymentProof"("methodId", "transactionId");
