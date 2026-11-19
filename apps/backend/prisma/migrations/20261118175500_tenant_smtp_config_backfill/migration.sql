-- Tenant SMTP backfill (smtp-balance-design.md §9.2 step 1). Data only;
-- the DDL lives in 20261118175400_tenant_smtp_config.
--
-- Copies the NON-SECRET fields (host, port, user, from address/name)
-- from the legacy SystemSetting smtp_* keys into SmtpConfig, mode BYO,
-- for every tenant that configured an SMTP host. The password is NOT
-- copied in SQL (it needs the app key): the lazy migration in code
-- (SmtpSettingsService.resolve) encrypts smtp_pass into
-- passwordEncrypted on first resolve and deletes the legacy key.
-- Idempotent: ON CONFLICT (tenant_id) DO NOTHING.
--
-- The tenant_id_guard trigger requires app.tenant_id context, which a
-- multi-tenant backfill cannot provide per row — it is disabled for
-- this statement only and re-enabled immediately after. The whole file
-- runs in one transaction, so a failure restores the trigger.
ALTER TABLE "SmtpConfig" DISABLE TRIGGER tenant_id_guard;

INSERT INTO "SmtpConfig"
  ("id", "tenant_id", "mode", "host", "port", "username", "fromEmail", "fromName", "updatedAt")
SELECT
  gen_random_uuid(),
  tenant_id,
  'BYO',
  MAX(CASE WHEN key = 'smtp_host' THEN value END),
  -- Non-numeric legacy ports become NULL (the resolver defaults to 587);
  -- a bad cast must never fail the migration.
  CASE
    WHEN MAX(CASE WHEN key = 'smtp_port' THEN value END) ~ '^[0-9]+$'
    THEN (MAX(CASE WHEN key = 'smtp_port' THEN value END))::integer
    ELSE NULL
  END,
  MAX(CASE WHEN key = 'smtp_user' THEN value END),
  MAX(CASE WHEN key = 'smtp_from_email' THEN value END),
  MAX(CASE WHEN key = 'smtp_from_name' THEN value END),
  NOW()
FROM "SystemSetting"
WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_from_email', 'smtp_from_name')
GROUP BY tenant_id
HAVING MAX(CASE WHEN key = 'smtp_host' THEN value END) IS NOT NULL
   AND MAX(CASE WHEN key = 'smtp_host' THEN value END) <> ''
ON CONFLICT ("tenant_id") DO NOTHING;

ALTER TABLE "SmtpConfig" ENABLE TRIGGER tenant_id_guard;
