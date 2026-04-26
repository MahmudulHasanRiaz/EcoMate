-- Add showroomId to Order (POS / showroom linkage)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "showroomId" TEXT;

-- Index for reporting/filtering
CREATE INDEX IF NOT EXISTS "Order_showroomId_idx" ON "Order"("showroomId");

-- Foreign key to Showroom (optional relation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Order_showroomId_fkey'
  ) THEN
    ALTER TABLE "Order"
    ADD CONSTRAINT "Order_showroomId_fkey"
    FOREIGN KEY ("showroomId") REFERENCES "Showroom"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;

