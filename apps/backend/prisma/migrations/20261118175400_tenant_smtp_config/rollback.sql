-- Rollback for 20261118175400_tenant_smtp_config.
-- Drops the SmtpConfig table (its RLS policy + trigger go with it) and
-- the two enums. All tenant SMTP configs are lost; the legacy
-- SystemSetting smtp_* keys are untouched (the backfill never deleted
-- them), so a rollback followed by a re-deploy re-derives BYO configs
-- from the legacy keys — except passwords, which were encrypted into
-- passwordEncrypted by the lazy migration and are lost with the table
-- (tenants re-enter them). Run the backfill rollback first if it was
-- applied.
DROP TABLE IF EXISTS "SmtpConfig";
DROP TYPE IF EXISTS "SmtpEncryption";
DROP TYPE IF EXISTS "SmtpMode";
