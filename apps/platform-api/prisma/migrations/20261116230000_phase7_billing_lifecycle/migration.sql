-- Phase 7: billing lifecycle.
--  * Subscription.pendingPlanVersionId / pendingPlanEffectiveAt: next-period
--    plan changes (the renewal job applies them at period end).
--  * InvoiceReminder: one row per reminder actually sent, so the jobs never
--    spam. referenceId is an invoice id for invoice reminders, a subscription
--    id for the trial-ending reminder.
--  * Partial unique index on PaymentProof: the same transaction id on the
--    same payment method can only be PENDING or APPROVED once. A REJECTED
--    proof's transaction id can be resubmitted.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "pendingPlanVersionId" TEXT,
ADD COLUMN "pendingPlanEffectiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InvoiceReminder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceReminder_tenantId_kind_referenceId_key" ON "InvoiceReminder"("tenantId", "kind", "referenceId");

-- CreateIndex
CREATE INDEX "InvoiceReminder_tenantId_idx" ON "InvoiceReminder"("tenantId");

-- AddForeignKey
ALTER TABLE "InvoiceReminder" ADD CONSTRAINT "InvoiceReminder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingPlanVersionId_fkey" FOREIGN KEY ("pendingPlanVersionId") REFERENCES "PlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (duplicate transaction detection, enforced at the DB level)
CREATE UNIQUE INDEX "PaymentProof_methodId_transactionId_active_key" ON "PaymentProof"("methodId", "transactionId") WHERE "status" IN ('PENDING', 'APPROVED');
