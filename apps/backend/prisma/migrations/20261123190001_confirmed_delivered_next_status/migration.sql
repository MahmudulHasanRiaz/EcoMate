-- Backfill: append Delivered to Confirmed.nextStatuses (Boss directive
-- 2026-11-23 — the Confirmed → Delivered edge is now legal in
-- ORDER_TRANSITIONS).
--
-- nextStatuses is a jsonb array of OrderStatus ids, written by seed /
-- tenant-bootstrap ONLY for statuses created by that run — existing
-- tenants' Confirmed rows keep their old list until this migration runs.
-- The runtime gate reads the code constant, not this column; the column
-- feeds display uses only (scanner allowed-statuses), so a stale row
-- hides the new edge from the scanner UI without blocking sync.
--
-- Per-tenant: the Delivered id is resolved inside the tenant (status
-- rows are per-tenant). Idempotent: the NOT (... @> ...) guard skips
-- rows that already list Delivered, and the join skips tenants with no
-- Delivered row at all. No schema change — DML only.
--
-- The tenant_id_guard trigger requires app.tenant_id context, which a
-- multi-tenant backfill cannot provide per row (and it would OVERWRITE
-- tenant_id with the context value) — it is disabled for this statement
-- only and re-enabled immediately after, the same pattern as
-- 20261118175500_tenant_smtp_config_backfill. The whole file runs in
-- one transaction, so a failure restores the trigger.
ALTER TABLE "OrderStatus" DISABLE TRIGGER tenant_id_guard;

UPDATE "OrderStatus" c
SET "nextStatuses" = COALESCE(c."nextStatuses", '[]'::jsonb) || to_jsonb(d.id)
FROM "OrderStatus" d
WHERE c.name = 'Confirmed'
  AND d."tenant_id" = c."tenant_id"
  AND d.name = 'Delivered'
  AND NOT (COALESCE(c."nextStatuses", '[]'::jsonb) @> to_jsonb(d.id));

ALTER TABLE "OrderStatus" ENABLE TRIGGER tenant_id_guard;
