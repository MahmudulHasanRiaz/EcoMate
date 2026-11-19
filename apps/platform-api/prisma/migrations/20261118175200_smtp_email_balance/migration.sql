-- SMTP email balance (smtp-balance-design.md §4, §11.1). The balance is a
-- COUNT of sendable emails, never money. Lots are the truth; the cached
-- counter on TenantEmailAccount is a read optimisation. DDL only — the
-- data backfill (free grants for existing tenants + saas_smtp defaults)
-- lives in 20261118175300_smtp_email_balance_backfill.
--
-- InvoiceKind is NOT created here: the pricing migration
-- (20261118155600_pricing_engine) creates the full enum including TOPUP,
-- and this migration sorts after it. EmailTopUp references Invoice 1:1
-- and needs no enum work of its own.

-- CreateEnum
CREATE TYPE "EmailLotSource" AS ENUM ('FREE_GRANT', 'TOPUP', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EmailLedgerKind" AS ENUM ('GRANT', 'SEND', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EmailTopUpStatus" AS ENUM ('PENDING', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "EmailBalanceLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" "EmailLotSource" NOT NULL,
    "emailsTotal" INTEGER NOT NULL,
    "emailsRemaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "topUpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailBalanceLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailBalanceLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lotId" TEXT,
    "kind" "EmailLedgerKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailBalanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTopUp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountBDT" DECIMAL(12, 2) NOT NULL,
    "emailsGranted" INTEGER NOT NULL,
    "rateSnapshot" JSONB NOT NULL,
    "status" "EmailTopUpStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "EmailTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantEmailAccount" (
    "tenantId" TEXT NOT NULL,
    "balanceCached" INTEGER NOT NULL DEFAULT 0,
    "freeGrantClaimed" BOOLEAN NOT NULL DEFAULT false,
    "lowBalanceNotifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantEmailAccount_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTopUp_invoiceId_key" ON "EmailTopUp"("invoiceId");

-- CreateIndex
CREATE INDEX "EmailBalanceLot_tenantId_expiresAt_idx" ON "EmailBalanceLot"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "EmailBalanceLot_expiresAt_idx" ON "EmailBalanceLot"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailBalanceLot_tenantId_createdAt_idx" ON "EmailBalanceLot"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailBalanceLedger_tenantId_createdAt_idx" ON "EmailBalanceLedger"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailTopUp_tenantId_status_idx" ON "EmailTopUp"("tenantId", "status");

-- Partial unique index: the idempotency guard for retried send jobs
-- (§4.4). One SEND ledger row per (tenant, BullMQ job id); a retry finds
-- the existing row instead of double-charging. Prisma has no
-- partial-index support, so this lives in raw SQL. NULL references never
-- collide (Postgres treats NULLs as distinct in unique indexes).
CREATE UNIQUE INDEX "EmailBalanceLedger_tenantId_reference_send_key" ON "EmailBalanceLedger"("tenantId", "reference") WHERE "kind" = 'SEND';

-- AddForeignKey
ALTER TABLE "EmailBalanceLot" ADD CONSTRAINT "EmailBalanceLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBalanceLot" ADD CONSTRAINT "EmailBalanceLot_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "EmailTopUp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBalanceLedger" ADD CONSTRAINT "EmailBalanceLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailBalanceLedger" ADD CONSTRAINT "EmailBalanceLedger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "EmailBalanceLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTopUp" ADD CONSTRAINT "EmailTopUp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTopUp" ADD CONSTRAINT "EmailTopUp_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantEmailAccount" ADD CONSTRAINT "TenantEmailAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
