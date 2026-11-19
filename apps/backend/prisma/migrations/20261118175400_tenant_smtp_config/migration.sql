-- Tenant SMTP config (smtp-balance-design.md §9.1, §11.2). One row per
-- tenant: BYO (own SMTP, any provider) or SAAS (shared EcoMate SMTP,
-- billed against the prepaid email balance). Default SAAS — a new tenant
-- sends immediately against the free grant; BYO is opt-in.
--
-- RLS follows the 0002_rls_and_tenant_guards pattern exactly: ENABLE +
-- FORCE + the tenant_isolation policy + the tenant_id_guard trigger
-- (enforce_tenant_id() already exists from 0002). A tenant's SMTP
-- credentials are never visible to another tenant. DDL only — the
-- backfill from legacy SystemSetting keys lives in
-- 20261118175500_tenant_smtp_config_backfill.

-- CreateEnum
CREATE TYPE "SmtpMode" AS ENUM ('BYO', 'SAAS');

-- CreateEnum
CREATE TYPE "SmtpEncryption" AS ENUM ('NONE', 'STARTTLS', 'SSL');

-- CreateTable
CREATE TABLE "SmtpConfig" (
    "id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid,
    "mode" "SmtpMode" NOT NULL DEFAULT 'SAAS',
    "host" TEXT,
    "port" INTEGER,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "encryption" "SmtpEncryption" NOT NULL DEFAULT 'STARTTLS',
    "fromEmail" TEXT,
    "fromName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmtpConfig_tenant_id_key" ON "SmtpConfig"("tenant_id");

-- Row Level Security (same shape as every other tenant table in 0002).
ALTER TABLE "SmtpConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SmtpConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SmtpConfig";
CREATE POLICY tenant_isolation ON "SmtpConfig"
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
DROP TRIGGER IF EXISTS tenant_id_guard ON "SmtpConfig";
CREATE TRIGGER tenant_id_guard BEFORE INSERT OR UPDATE ON "SmtpConfig"
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_id();

-- The app role reads/writes this table like every other tenant table.
-- (0002's default privileges cover tables created by the migrator; this
-- grant makes the migration self-contained for deployments whose
-- migrator role differs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecomate_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "SmtpConfig" TO ecomate_app';
  END IF;
END $$;
