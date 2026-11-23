-- WooCommerce product import (§22 item 1) — DDL-ONLY.
--
-- Adds the PRODUCT_IMPORT scope value to SyncRunScope so import runs are
-- SyncRuns (§10.1). DDL-only by rule: enum ADD VALUE and DML using the new
-- value NEVER share one migration (55P04 — the value must be committed
-- before any DML can reference it). No DML in this file.

-- AlterEnum
ALTER TYPE "SyncRunScope" ADD VALUE 'PRODUCT_IMPORT';
