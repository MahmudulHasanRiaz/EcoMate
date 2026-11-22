-- Rollback for 20261122150500_central_commerce_order_fields.
-- Removes the P6/P8 Order columns + indexes. RLS on Order is untouched
-- (it predates this migration). Data in the dropped columns is lost —
-- this is a destructive rollback; take a snapshot first in production.
ALTER TABLE "Order" DROP COLUMN IF EXISTS "storeMetadata";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "ingestFlags";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "externalOrderId";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "marketingChannel";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "showroomId";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "salesChannelType";
