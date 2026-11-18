-- Rollback for 20261118085100_lead_status_values.
--
-- Postgres has no ALTER TYPE ... DROP VALUE, so enum values cannot be
-- removed in place. The only rollback is recreating the enum without the
-- four Batch 1 values. That requires every row currently in one of the
-- four new statuses to move first — this script maps them to the closest
-- pre-existing status (QUALIFIED/DEMO_SCHEDULED/WON -> CONTACTED, LOST
-- -> CLOSED). Run it only when no code path writes the new values
-- anymore (i.e. after rolling the application back too).
--
-- NOTE: the mapping loses the distinction between the new statuses and
-- CONTACTED/CLOSED. That is inherent to an enum rollback — there is no
-- lossless way to remove enum values.

UPDATE "Lead" SET "status" = 'CONTACTED'
  WHERE "status" IN ('QUALIFIED', 'DEMO_SCHEDULED', 'WON');
UPDATE "Lead" SET "status" = 'CLOSED' WHERE "status" = 'LOST';

ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');
ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus"
  USING "status"::text::"LeadStatus";
DROP TYPE "LeadStatus_old";
