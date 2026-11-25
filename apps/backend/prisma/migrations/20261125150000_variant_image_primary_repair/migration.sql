-- Data repair (2026-11-25, variant-image staleness): ProductVariant has
-- two image columns. The admin variant-image manager's server-mode save
-- sent only `images`, never `image`, so `image` kept the FIRST-picked
-- file while `images[0]` moved on — and the push path reads `image`
-- first (variantPrimaryImage), re-sending the stale file on every push
-- (live: VAR-TEST-001 S re-uploaded the broken webp as -2/-3.webp).
-- The write layer is fixed alongside this migration (admin sends `image`
-- too; updateVariant derives it from `images[0]`); this repair heals
-- rows already diverged, incl. VAR-TEST-001 S on staging.
--
-- Idempotent: only rows where `image` differs from `images[0]` are
-- touched; re-running changes nothing. Scope is deliberately the
-- mismatch-to-first case only — rows whose images were emptied are left
-- for the next manager save (which now sends `image: null`).
--
-- Same trigger handling as 20261123190001: the tenant_id_guard trigger
-- requires app.tenant_id context, which a multi-tenant backfill cannot
-- provide per row — disabled for this statement only and re-enabled
-- immediately after. The whole file runs in one transaction.
ALTER TABLE "ProductVariant" DISABLE TRIGGER tenant_id_guard;

UPDATE "ProductVariant"
SET "image" = ("images" ->> 0)
WHERE "images" IS NOT NULL
  AND jsonb_typeof("images") = 'array'
  AND jsonb_array_length("images") > 0
  AND ("image" IS DISTINCT FROM ("images" ->> 0));

ALTER TABLE "ProductVariant" ENABLE TRIGGER tenant_id_guard;
