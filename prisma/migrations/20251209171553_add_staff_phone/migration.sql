ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "phone" TEXT;
UPDATE "StaffMember" SET "phone" = COALESCE("phone", '01700000000');
ALTER TABLE "StaffMember" ALTER COLUMN "phone" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "StaffMember_phone_key" ON "StaffMember"("phone");

CREATE INDEX IF NOT EXISTS "Order_status_date_idx" ON "Order"("status", "date");
CREATE INDEX IF NOT EXISTS "Order_customerPhone_idx" ON "Order"("customerPhone");
CREATE INDEX IF NOT EXISTS "Order_businessId_idx" ON "Order"("businessId");
CREATE INDEX IF NOT EXISTS "Order_platform_idx" ON "Order"("platform");
