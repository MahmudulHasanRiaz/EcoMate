-- Add status column with default Pending, set Accepted when usedAt is present, otherwise Pending
ALTER TABLE "StaffInvite" ADD COLUMN "status" TEXT DEFAULT 'Pending';

UPDATE "StaffInvite"
SET "status" = CASE
  WHEN "usedAt" IS NOT NULL THEN 'Accepted'
  ELSE 'Pending'
END;

ALTER TABLE "StaffInvite" ALTER COLUMN "status" SET NOT NULL;
