-- Add staffCode column with backfill and uniqueness
ALTER TABLE "StaffMember" ADD COLUMN "staffCode" TEXT;

-- Backfill existing rows with a short deterministic code based on id prefix
UPDATE "StaffMember"
SET "staffCode" = CONCAT('STF-', SUBSTRING("id", 1, 8))
WHERE "staffCode" IS NULL;

-- Enforce not-null and uniqueness
ALTER TABLE "StaffMember" ALTER COLUMN "staffCode" SET NOT NULL;
CREATE UNIQUE INDEX "StaffMember_staffCode_key" ON "StaffMember"("staffCode");

