-- Rollback for 20261123190001_confirmed_delivered_next_status.
-- Removes the Delivered id from Confirmed.nextStatuses (per tenant).
-- Note: this also removes a Delivered entry a tenant hand-configured
-- before the migration — the seed never wrote one (the constant lacked
-- the edge), so in practice this restores exactly the pre-migration list.
--
-- Same trigger handling as the forward migration: tenant_id_guard is
-- disabled for this statement only and re-enabled immediately after.
ALTER TABLE "OrderStatus" DISABLE TRIGGER tenant_id_guard;

UPDATE "OrderStatus" c
SET "nextStatuses" = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(c."nextStatuses", '[]'::jsonb)) AS elem
  WHERE elem <> to_jsonb(d.id)
)
FROM "OrderStatus" d
WHERE c.name = 'Confirmed'
  AND d."tenant_id" = c."tenant_id"
  AND d.name = 'Delivered';

ALTER TABLE "OrderStatus" ENABLE TRIGGER tenant_id_guard;
