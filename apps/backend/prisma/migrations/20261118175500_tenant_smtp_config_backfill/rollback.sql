-- Rollback for 20261118175500_tenant_smtp_config_backfill.
-- Removes the rows the backfill created: BYO configs for tenants that
-- still have a legacy smtp_host key. Only valid shortly after the
-- backfill — a tenant that configured BYO through the new settings page
-- after the backfill is indistinguishable from a backfilled row, so this
-- deletes those too (the legacy keys survive, and a re-run of the
-- backfill re-derives them minus the password). Run this BEFORE the DDL
-- rollback (which drops the table).
DELETE FROM "SmtpConfig" c
WHERE c.mode = 'BYO'
  AND EXISTS (
    SELECT 1 FROM "SystemSetting" s
    WHERE s.tenant_id = c.tenant_id AND s.key = 'smtp_host'
  );
