-- WooCommerce product import (§22 item 2, §14.2 gap 1) — reverse uniques.
--
-- The import dedup lookup is by (storeId, externalId) (§9.2); until now the
-- only unique was (storeId, productId), so two mappings could claim the
-- same remote product and the reverse lookup was an unindexed scan. These
-- uniques are the database-level idempotency backstop: if two creates for
-- the same remote product race past the store lock, one fails with P2002
-- and is recorded as a duplicate instead of double-binding.
--
-- Pre-apply check (test DB 2026-11-23): 0 duplicate (storeId, externalId)
-- pairs on either table (both tables empty in the test env; staging/prod
-- mappings are push-created, one per remote product). The CREATE UNIQUE
-- INDEX itself fails loudly if duplicates exist — resolve them by hand
-- before re-applying; do NOT strip the unique to force the migration
-- through.

-- CreateIndex
CREATE UNIQUE INDEX "StoreProductMapping_storeId_externalId_key" ON "StoreProductMapping"("storeId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreVariantMapping_storeId_externalId_key" ON "StoreVariantMapping"("storeId", "externalId");
