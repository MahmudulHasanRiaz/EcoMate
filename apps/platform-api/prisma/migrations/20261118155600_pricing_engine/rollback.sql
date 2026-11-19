-- Rollback for 20261118155600_pricing_engine.
-- Drops the pricing tables, columns and enums in reverse order. Pricing
-- overrides, purchases and blocking overrides recorded after the
-- migration are lost; invoices keep their money data (only kind/metadata
-- are dropped). Run the backfill rollback first if it was applied (it
-- only resets data the DDL rollback drops anyway).
DROP TABLE IF EXISTS "TenantBlockingOverride";
DROP TABLE IF EXISTS "TenantPurchase";
DROP TABLE IF EXISTS "TenantPricingOverride";
DROP INDEX IF EXISTS "Invoice_kind_status_createdAt_idx";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "metadata";
ALTER TABLE "AddOn" DROP COLUMN IF EXISTS "isPublic";
ALTER TABLE "AddOn" DROP COLUMN IF EXISTS "sortOrder";
ALTER TABLE "AddOn" DROP COLUMN IF EXISTS "metering";
ALTER TABLE "Subscription" DROP COLUMN IF EXISTS "freePeriodsRemaining";
ALTER TABLE "PlanVersion" DROP COLUMN IF EXISTS "pricing";
DROP TYPE IF EXISTS "PurchaseStatus";
DROP TYPE IF EXISTS "PurchaseType";
DROP TYPE IF EXISTS "InvoiceKind";
