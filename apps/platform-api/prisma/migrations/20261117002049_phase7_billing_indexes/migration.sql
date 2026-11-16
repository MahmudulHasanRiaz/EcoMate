-- Phase 7 billing index audit (per the standing indexing rule: indexes
-- everywhere a real query benefits, verified against the jobs' and
-- services' actual queries — not just where strictly necessary).
--
-- New indexes:
--  * Subscription(status, trialEndsAt): trial-expiry job — reminder scan
--    (TRIAL + trialEndsAt in the next 3 days) and expiry scan (TRIAL +
--    trialEndsAt <= now). The existing (status, currentPeriodEnd) cannot
--    serve a trialEndsAt range.
--  * Subscription(cancelAtPeriodEnd, currentPeriodEnd): cancel-at-period-end
--    job (cancelAtPeriodEnd + period end in the past).
--  * Invoice(subscriptionId, status, periodStart): renewal idempotency guard
--    (one lookup per due subscription per run; Invoice had no
--    subscriptionId index at all).
--  * Invoice(createdAt): nextInvoiceNumber month count on EVERY invoice
--    creation, plus the unfiltered invoice list ordering.
--  * Tenant(status, graceEndsAt): grace-suspend job (PAST_DUE + grace ended).
--
-- Replaced (same leading column, strictly better — no extra index):
--  * Subscription(planVersionId) -> (planVersionId, status): applyVersion
--    filters planVersion + status IN (TRIAL, ACTIVE, PAST_DUE).
--  * CreditNote(tenantId) -> (tenantId, appliedInvoiceId, createdAt):
--    applyOpenCredit (tenant + open notes, oldest first).
--
-- Dropped:
--  * PaymentProof full unique (methodId, transactionId): redundant with the
--    Phase 7 partial unique index (status IN PENDING/APPROVED) and it
--    contradicts the intended behaviour — a REJECTED proof's transaction id
--    must be resubmittable (submitProof only blocks PENDING/APPROVED
--    duplicates). With the full unique in place a resubmission died with an
--    unhandled P2002. The partial index stays as the DB-level guard.
--
-- Deliberately NOT added (verified, no material benefit):
--  * Tenant(status, suspendedAt): SUSPENDED is highly selective; the
--    existing (status, createdAt) already narrows to the tiny suspended set.
--  * Invoice(tenantId, createdAt): per-tenant invoice sets are small; the
--    in-memory sort is trivial. (status, dueAt) already serves the
--    reminders job and (tenantId, status) the tenant lists.

-- CreateIndex
CREATE INDEX "Subscription_status_trialEndsAt_idx" ON "Subscription"("status", "trialEndsAt");

-- CreateIndex
CREATE INDEX "Subscription_cancelAtPeriodEnd_currentPeriodEnd_idx" ON "Subscription"("cancelAtPeriodEnd", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_status_periodStart_idx" ON "Invoice"("subscriptionId", "status", "periodStart");

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- CreateIndex
CREATE INDEX "Tenant_status_graceEndsAt_idx" ON "Tenant"("status", "graceEndsAt");

-- ReplaceIndex: Subscription(planVersionId) -> (planVersionId, status)
DROP INDEX "Subscription_planVersionId_idx";
CREATE INDEX "Subscription_planVersionId_status_idx" ON "Subscription"("planVersionId", "status");

-- ReplaceIndex: CreditNote(tenantId) -> (tenantId, appliedInvoiceId, createdAt)
DROP INDEX "CreditNote_tenantId_idx";
CREATE INDEX "CreditNote_tenantId_appliedInvoiceId_createdAt_idx" ON "CreditNote"("tenantId", "appliedInvoiceId", "createdAt");

-- DropIndex: full unique superseded by the Phase 7 partial unique index
DROP INDEX "PaymentProof_methodId_transactionId_key";
