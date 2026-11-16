-- Rollback for 20261116101222_tenant_limit_overrides.
--
-- The table only holds platform-side negotiation overrides; dropping it
-- restores plan-only limits. Run only when deliberately reverting this release
-- (tenant runtime reads overrides through the platform registry, so removing
-- the table while the new platform build is still running would break usage
-- reads). Data in this table is not recoverable after the drop.
DROP TABLE IF EXISTS "TenantLimitOverride";
