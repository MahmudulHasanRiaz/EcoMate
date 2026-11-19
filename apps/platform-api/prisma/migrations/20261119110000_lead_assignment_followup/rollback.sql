-- Rollback for 20261119110000_lead_assignment_followup.
-- Drops the assignment / follow-up / notes columns (all lead assignment
-- state, follow-up dates and internal notes are lost). The audit log
-- keeps the history of what was assigned/set (lead.assigned,
-- lead.followup.update, lead.notes.update actions), so the record of
-- who did what survives even though the current values do not.
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_assignedToId_fkey";
DROP INDEX IF EXISTS "Lead_followUpAt_idx";
DROP INDEX IF EXISTS "Lead_assignedToId_idx";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "internalNotes";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "followUpAt";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "assignedToId";
