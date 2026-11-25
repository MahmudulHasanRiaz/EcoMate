-- Data repair (2026-11-25, Woo order-ingest status fix): Woo `processing`
-- orders landed Confirmed because the live-ingest map reused the CSV
-- importer's STATUS_MAP (`processing → Confirmed`). Boss decision
-- 2026-11-25: Woo `processing` lands Pending — new orders arrive Pending
-- and are confirmed by hand. The code fix adds the Woo-only override
-- (`STORE_STATUS_OVERRIDES.processing = 'Pending'`, scoped in
-- resolveStatusName/ensureStatusMaps); this repair heals rows already
-- seeded with the old value.
--
-- Scope is deliberately narrow:
-- - Woo stores ONLY (`Store.kind = 'WOOCOMMERCE'`) — the bridge also
--   emits `processing` and its landing rule was never decided, so bridge
--   rows keep `processing → Confirmed`;
-- - only rows still holding the old value (`internalStatusName =
--   'Confirmed'`) — an operator edit to anything else is preserved.
--
-- Idempotent: re-running updates 0 rows.
-- Same trigger handling as 20261125150000: the tenant_id_guard trigger
-- requires app.tenant_id context, which a multi-tenant backfill cannot
-- provide per row — disabled for this statement only and re-enabled
-- immediately after. The whole file runs in one transaction.
ALTER TABLE "StoreOrderStatusMap" DISABLE TRIGGER tenant_id_guard;

UPDATE "StoreOrderStatusMap" m
SET "internalStatusName" = 'Pending'
FROM "Store" s
WHERE m."storeId" = s."id"
  AND s."kind" = 'WOOCOMMERCE'
  AND m."externalStatus" = 'processing'
  AND m."internalStatusName" = 'Confirmed';

ALTER TABLE "StoreOrderStatusMap" ENABLE TRIGGER tenant_id_guard;
