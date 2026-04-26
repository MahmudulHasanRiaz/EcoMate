-- Reconcile drift: order type/status + webhook failure + staff income.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderType') THEN
        CREATE TYPE "OrderType" AS ENUM ('REGULAR', 'PARTIAL_RETURN', 'EXCHANGE');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffIncomeAction') THEN
        CREATE TYPE "StaffIncomeAction" AS ENUM ('Created', 'Confirmed', 'Packed');
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'OrderStatus' AND e.enumlabel = 'Damaged'
        ) THEN
            ALTER TYPE "OrderStatus" ADD VALUE 'Damaged';
        END IF;
    ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'orderstatus') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'orderstatus' AND e.enumlabel = 'Damaged'
        ) THEN
            ALTER TYPE orderstatus ADD VALUE 'Damaged';
        END IF;
    END IF;
END $$;

ALTER TABLE "Order"
    ADD COLUMN IF NOT EXISTS "exchangeSourceOrderId" TEXT,
    ADD COLUMN IF NOT EXISTS "isExchange" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "parentOrderId" TEXT,
    ADD COLUMN IF NOT EXISTS "type" "OrderType" NOT NULL DEFAULT 'REGULAR';

CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_parentOrderId_fkey') THEN
        ALTER TABLE "Order"
            ADD CONSTRAINT "Order_parentOrderId_fkey"
            FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WebhookFailure" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "integrationId" TEXT,
    "orderId" TEXT,
    "externalOrderId" TEXT,
    "payload" JSONB,
    "error" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookFailure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WebhookFailure_source_idx" ON "WebhookFailure"("source");
CREATE INDEX IF NOT EXISTS "WebhookFailure_integrationId_idx" ON "WebhookFailure"("integrationId");
CREATE INDEX IF NOT EXISTS "WebhookFailure_orderId_idx" ON "WebhookFailure"("orderId");
CREATE INDEX IF NOT EXISTS "WebhookFailure_createdAt_idx" ON "WebhookFailure"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebhookFailure_integrationId_fkey') THEN
        ALTER TABLE "WebhookFailure"
            ADD CONSTRAINT "WebhookFailure_integrationId_fkey"
            FOREIGN KEY ("integrationId") REFERENCES "WooCommerceIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebhookFailure_orderId_fkey') THEN
        ALTER TABLE "WebhookFailure"
            ADD CONSTRAINT "WebhookFailure_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StaffIncome" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "orderId" TEXT,
    "action" "StaffIncomeAction" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffIncome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffIncome_staffId_orderId_action_key" ON "StaffIncome"("staffId", "orderId", "action");
CREATE INDEX IF NOT EXISTS "StaffIncome_staffId_idx" ON "StaffIncome"("staffId");
CREATE INDEX IF NOT EXISTS "StaffIncome_orderId_idx" ON "StaffIncome"("orderId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffIncome_staffId_fkey') THEN
        ALTER TABLE "StaffIncome"
            ADD CONSTRAINT "StaffIncome_staffId_fkey"
            FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffIncome_orderId_fkey') THEN
        ALTER TABLE "StaffIncome"
            ADD CONSTRAINT "StaffIncome_orderId_fkey"
            FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
