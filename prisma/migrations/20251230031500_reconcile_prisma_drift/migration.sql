-- Reconcile manual schema changes without dropping data.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationIcon') THEN
        CREATE TYPE "NotificationIcon" AS ENUM ('Bell', 'ShoppingCart', 'Warehouse', 'Archive', 'AlertCircle', 'User');
    END IF;
END $$;

ALTER TABLE "InventoryItem"
    ADD COLUMN IF NOT EXISTS "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "isStockDeducted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "isStockReserved" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order"
    ALTER COLUMN "shippingAddress" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "href" TEXT NOT NULL,
    "icon" "NotificationIcon" NOT NULL DEFAULT 'Bell',

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_staffId_fkey') THEN
        ALTER TABLE "Notification"
            ADD CONSTRAINT "Notification_staffId_fkey"
            FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Notification_staffId_read_idx" ON "Notification"("staffId", "read");
CREATE INDEX IF NOT EXISTS "Notification_time_idx" ON "Notification"("time");
