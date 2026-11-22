-- Rollback for 20261122150000_tenant_external_store_binding (DDL only).
-- Drops the TenantExternalStoreBinding table and the StoreProvider /
-- BindingStatus enums. Any claimed external-store bindings are lost:
-- tenants keep their tenant-DB Store rows, but the platform-side claim
-- (and the resolver's store -> tenant mapping) is gone, so external
-- webhooks fail closed until the bindings are re-claimed. Only roll
-- back while central commerce is still disabled (kill switches off);
-- never roll back with live connected stores.
DROP TABLE IF EXISTS "TenantExternalStoreBinding";
DROP TYPE IF EXISTS "BindingStatus";
DROP TYPE IF EXISTS "StoreProvider";
