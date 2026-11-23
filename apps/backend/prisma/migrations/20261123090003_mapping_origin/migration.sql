-- WooCommerce product import (§22 item 3, §14.2 gap 2) — mapping origin.
--
-- NEW enum MappingOrigin (PUSH, IMPORT_CREATE, IMPORT_LINK) + `origin`
-- columns on both mapping models, default PUSH. The enum is NEW (not an
-- ADD VALUE to an existing enum), so enum-create + column-add in one
-- migration is fine; the column DEFAULT backfills every existing row to
-- PUSH — correct, because import did not exist before, so every
-- pre-existing mapping was created by push. No separate backfill UPDATE
-- is needed (the DEFAULT applies at ADD COLUMN time).
--
-- Origin drives the remote-delete rule (§18.4): PUSH-origin products are
-- re-created by push when the remote is gone; IMPORT-origin products are
-- unlinked and the local product survives.

-- CreateEnum
CREATE TYPE "MappingOrigin" AS ENUM ('PUSH', 'IMPORT_CREATE', 'IMPORT_LINK');

-- AlterTable
ALTER TABLE "StoreProductMapping" ADD COLUMN "origin" "MappingOrigin" NOT NULL DEFAULT 'PUSH';

-- AlterTable
ALTER TABLE "StoreVariantMapping" ADD COLUMN "origin" "MappingOrigin" NOT NULL DEFAULT 'PUSH';
